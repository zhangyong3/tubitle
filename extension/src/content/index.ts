import { fetchBilingualCaptions } from "./captions";
import { SubtitleOverlay } from "./overlay";
import { prefetchBatchPlan, type PrefetchBatchState } from "./prefetch";
import { shortcutFromEvent, shortcutsMatch } from "./shortcuts";
import { findSentenceIndex, navigationTargetIndex, type NavigationDirection } from "./navigation";
import { sendMessage } from "../shared/messaging";
import { getSettings, updateSettings } from "../shared/settings";
import type {
  CaptionSentence,
  CaptionTrack,
  ExtensionSettings
} from "../shared/types";
import type { TranscriptCue } from "../shared/youtube-transcript";
import { cuesToSentences } from "./captions";

let settings: ExtensionSettings;
let sentences: CaptionSentence[] = [];
let activeIndex = -1;
let loadVersion = 0;
let pausedByHover = false;
let lastLayoutUpdate = 0;
let unavailableSubtitleTimer: number | undefined;
const translations = new Map<string, string>();
const officialTranslations = new Map<string, string>();
const pendingTranslations = new Map<string, Promise<string>>();
const queuedTranslationKeys = new Set<string>();
const translationQueue: Array<{ sentence: CaptionSentence; provider: ExtensionSettings["provider"]; key: string }> = [];
const prefetchBlockedUntil = new Map<ExtensionSettings["provider"], number>();
const prefetchStateByProvider = new Map<ExtensionSettings["provider"], PrefetchBatchState>();
const TRANSLATION_BATCH_SIZE = 15;
const PREFETCH_REFILL_RATIO = 0.4;
const MAX_TRANSLATION_WORKERS = 15;
let activeTranslationWorkers = 0;

const nativeCaptionStyle = document.createElement("style");
nativeCaptionStyle.id = "tubetitle-hide-native-captions";
nativeCaptionStyle.textContent = ".ytp-caption-window-container{display:none!important}";

function videoElement(): HTMLVideoElement | null {
  return document.querySelector("video.html5-main-video, video");
}

const overlay = new SubtitleOverlay({
  onEnter: () => {
    if (!settings.hoverPause) return;
    const video = videoElement();
    if (video && !video.paused) {
      pausedByHover = true;
      video.pause();
    }
  },
  onLeave: () => {
    const video = videoElement();
    if (pausedByHover && settings.resumeAfterHover && video) void video.play().catch(() => undefined);
    pausedByHover = false;
  },
  onLookup: (word) => {
    void sendMessage({
      type: "OPEN_DICTIONARY",
      word,
      offline: settings.offlineDictionary.configured
    }).catch((error: unknown) => {
      overlay.showStatus(errorMessage(error), true);
    });
  },
  onCopy: async (word) => {
    await navigator.clipboard.writeText(word);
  },
  onPositionChange: (position) => {
    settings = { ...settings, subtitlePosition: position };
    void updateSettings({ subtitlePosition: position });
  },
  onAnalyze: () => void analyzeCurrentSentence()
});

function applySettings(): void {
  overlay.setEnabled(settings.enabled);
  overlay.setChineseVisible(settings.showChinese);
  overlay.setAppearance(settings.subtitleAppearance);
  overlay.setPosition(settings.subtitlePosition);
  if (settings.enabled && sentences.length > 0 && !nativeCaptionStyle.isConnected) {
    document.documentElement.append(nativeCaptionStyle);
  } else if (!settings.enabled || sentences.length === 0) {
    nativeCaptionStyle.remove();
  }
  if (settings.showChinese && activeIndex >= 0) void translateSentence(sentences[activeIndex]!);
}

function requestTranscript(videoId: string): Promise<TranscriptCue[]> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      document.removeEventListener("tubitle:transcript", onResponse);
      reject(new Error("读取 YouTube 文字稿超时"));
    }, 25_000);
    const onResponse = (event: Event): void => {
      const detail = (event as CustomEvent<{
        requestId?: string;
        cues?: TranscriptCue[];
        error?: string;
      }>).detail;
      if (detail?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      document.removeEventListener("tubitle:transcript", onResponse);
      if (detail.error) reject(new Error(detail.error));
      else resolve(detail.cues ?? []);
    };
    document.addEventListener("tubitle:transcript", onResponse);
    document.dispatchEvent(new CustomEvent("tubitle:request-transcript", {
      detail: { requestId, videoId }
    }));
  });
}

async function loadTracks(tracks: CaptionTrack[], pageUrl = location.href): Promise<void> {
  const version = ++loadVersion;
  window.clearTimeout(unavailableSubtitleTimer);
  unavailableSubtitleTimer = undefined;
  sentences = [];
  activeIndex = -1;
  translations.clear();
  officialTranslations.clear();
  translationQueue.length = 0;
  queuedTranslationKeys.clear();
  prefetchStateByProvider.clear();
  overlay.hideSentence();
  overlay.clearStatus();
  applySettings();
  try {
    let loaded;
    try {
      loaded = await fetchBilingualCaptions(tracks);
    } catch (captionError) {
      const videoId = new URL(pageUrl).searchParams.get("v");
      if (!videoId) throw captionError;
      try {
        const transcript = await requestTranscript(videoId);
        const fallbackSentences = cuesToSentences(transcript);
        if (fallbackSentences.length === 0) throw new Error("YouTube 文字稿为空");
        loaded = { sentences: fallbackSentences, officialTranslations: new Map<string, string>() };
      } catch (transcriptError) {
        const primary = errorMessage(captionError);
        if (primary === "这个视频没有可用的英文字幕" || primary === "字幕轨道为空") {
          throw new Error("没有可用的英文字幕");
        }
        const fallback = errorMessage(transcriptError);
        throw new Error(`${primary}；文字稿回退失败：${fallback}`);
      }
    }
    if (version !== loadVersion) return;
    sentences = loaded.sentences;
    for (const [id, translation] of loaded.officialTranslations) officialTranslations.set(id, translation);
    applySettings();
    overlay.clearStatus();
  } catch (error) {
    if (version !== loadVersion) return;
    const message = errorMessage(error);
    overlay.showStatus(message, true);
    if (message === "没有可用的英文字幕") {
      unavailableSubtitleTimer = window.setTimeout(() => {
        if (version !== loadVersion) return;
        overlay.clearStatus();
        overlay.hideSentence();
        unavailableSubtitleTimer = undefined;
      }, 3000);
    }
  }
}

function translationKey(sentence: CaptionSentence, provider: ExtensionSettings["provider"]): string {
  return `${loadVersion}:${provider}:${sentence.id}`;
}

async function getSentenceTranslation(
  sentence: CaptionSentence,
  provider: ExtensionSettings["provider"]
): Promise<string> {
  const official = officialTranslations.get(sentence.id);
  if (official) return official;
  const key = translationKey(sentence, provider);
  const cached = translations.get(key);
  if (cached) return cached;
  const pending = pendingTranslations.get(key);
  if (pending) return pending;

  const request = sendMessage<string>({
    type: "TRANSLATE",
    text: sentence.text,
    provider
  }).then((translation) => {
    translations.set(key, translation);
    return translation;
  }).finally(() => {
    pendingTranslations.delete(key);
  });
  pendingTranslations.set(key, request);
  return request;
}

async function translateSentence(sentence: CaptionSentence): Promise<void> {
  if (!settings.showChinese) return;
  const provider = settings.provider;
  try {
    const translation = await getSentenceTranslation(sentence, provider);
    if (provider === settings.provider || officialTranslations.has(sentence.id)) {
      overlay.showTranslation(sentence.id, translation);
    }
  } catch (error) {
    overlay.showTranslationError(sentence.id, errorMessage(error));
  }
}

function scheduleTranslationPrefetch(currentIndex: number): void {
  if (!settings.showChinese) return;
  const provider = settings.provider;
  if ((prefetchBlockedUntil.get(provider) ?? 0) > Date.now()) return;
  const plan = prefetchBatchPlan(
    currentIndex,
    sentences.length,
    prefetchStateByProvider.get(provider),
    TRANSLATION_BATCH_SIZE,
    PREFETCH_REFILL_RATIO
  );
  prefetchStateByProvider.set(provider, plan.state);
  const indexes = plan.indexes;
  for (const index of indexes) {
    const sentence = sentences[index]!;
    const key = translationKey(sentence, provider);
    if (
      officialTranslations.has(sentence.id) ||
      translations.has(key) ||
      pendingTranslations.has(key) ||
      queuedTranslationKeys.has(key)
    ) continue;
    translationQueue.push({ sentence, provider, key });
    queuedTranslationKeys.add(key);
  }
  drainTranslationQueue();
}

function drainTranslationQueue(): void {
  while (activeTranslationWorkers < MAX_TRANSLATION_WORKERS && translationQueue.length > 0) {
    const item = translationQueue.shift()!;
    queuedTranslationKeys.delete(item.key);
    if ((prefetchBlockedUntil.get(item.provider) ?? 0) > Date.now()) continue;
    activeTranslationWorkers += 1;
    void getSentenceTranslation(item.sentence, item.provider)
      .catch(() => {
        prefetchBlockedUntil.set(item.provider, Date.now() + 30_000);
        for (let index = translationQueue.length - 1; index >= 0; index -= 1) {
          const queued = translationQueue[index]!;
          if (queued.provider === item.provider) {
            queuedTranslationKeys.delete(queued.key);
            translationQueue.splice(index, 1);
          }
        }
      })
      .finally(() => {
        activeTranslationWorkers -= 1;
        drainTranslationQueue();
      });
  }
}

async function analyzeCurrentSentence(): Promise<void> {
  const sentence = sentences[activeIndex];
  if (!sentence) return;
  try {
    await sendMessage<void>({
      type: "OPEN_ANALYSIS",
      sentence: sentence.text
    });
  } catch (error) {
    overlay.showStatus(errorMessage(error), true);
  }
}

function activateSentence(index: number): void {
  if (index === activeIndex) return;
  activeIndex = index;
  if (activeIndex < 0) {
    overlay.hideSentence();
    return;
  }
  const sentence = sentences[activeIndex]!;
  overlay.clearStatus();
  overlay.showSentence(sentence);
  void translateSentence(sentence);
  scheduleTranslationPrefetch(activeIndex);
}

function seekTo(index: number, video = videoElement()): void {
  const sentence = sentences[index];
  if (!sentence || !video) return;
  video.currentTime = sentence.startMs / 1000 + 0.01;
  activateSentence(index);
  void video.play().catch(() => undefined);
}

function seekRelative(direction: NavigationDirection): void {
  const video = videoElement();
  if (!video) return;
  const targetIndex = navigationTargetIndex(sentences, video.currentTime * 1000, direction);
  if (targetIndex >= 0) seekTo(targetIndex, video);
}

function handleShortcut(event: KeyboardEvent): void {
  if (!settings.enabled || event.repeat) return;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;
  const shortcut = shortcutFromEvent(event);
  let handled = true;
  if (shortcutsMatch(shortcut, settings.shortcuts.previous)) seekRelative(-1);
  else if (shortcutsMatch(shortcut, settings.shortcuts.next)) seekRelative(1);
  else if (shortcutsMatch(shortcut, settings.shortcuts.repeat)) seekRelative(0);
  else if (shortcutsMatch(shortcut, settings.shortcuts.toggleTranslation)) {
    settings.showChinese = !settings.showChinese;
    overlay.setChineseVisible(settings.showChinese);
    void updateSettings({ showChinese: settings.showChinese });
    const current = sentences[activeIndex];
    if (current && settings.showChinese) void translateSentence(current);
  } else if (shortcutsMatch(shortcut, settings.shortcuts.analyze)) void analyzeCurrentSentence();
  else handled = false;
  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function tick(timestamp: number): void {
  if (settings?.enabled) {
    const video = videoElement();
    if (video) {
      if (timestamp - lastLayoutUpdate >= 200) {
        const fullscreenParent = document.fullscreenElement;
        overlay.attachTo(fullscreenParent?.contains(video) ? fullscreenParent : document.documentElement);
        overlay.updateVideoBounds(video.getBoundingClientRect());
        lastLayoutUpdate = timestamp;
      }
      activateSentence(findSentenceIndex(sentences, video.currentTime * 1000));
    }
  }
  requestAnimationFrame(tick);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

document.addEventListener("tubetitle:tracks", (event) => {
  const detail = (event as CustomEvent<{ tracks: CaptionTrack[]; url?: string }>).detail;
  if (detail?.tracks) void loadTracks(detail.tracks, detail.url);
});
document.addEventListener("keydown", handleShortcut, true);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  void getSettings().then((next) => {
    const connectionChanged =
      settings.provider !== next.provider ||
      settings.serverBaseUrl !== next.serverBaseUrl ||
      settings.serverAccessToken !== next.serverAccessToken;
    if (connectionChanged) {
      translationQueue.length = 0;
      queuedTranslationKeys.clear();
      prefetchBlockedUntil.clear();
      prefetchStateByProvider.clear();
    }
    settings = next;
    applySettings();
    if (connectionChanged && activeIndex >= 0) scheduleTranslationPrefetch(activeIndex);
  });
});

void getSettings().then((loaded) => {
  settings = loaded;
  applySettings();
  document.dispatchEvent(new CustomEvent("tubetitle:request-tracks"));
  requestAnimationFrame(tick);
});
