import { SYNC_STATE_KEY } from "../shared/learning-sync";
import { PlaybackActivity } from "../shared/learning-activity";
import { PrefetchQueue } from "./prefetch-queue";
import { initializeI18n, subscribeUiLanguage } from "../shared/i18n";
import { historyNavigationAction } from "../shared/history-navigation";
import { decodeTextEntities } from "../shared/text-entities";
import { captionErrorNotice, CAPTION_NOTICE_DURATION_MS } from "./caption-errors";
import { sourceLanguage, shouldSkipTranslation } from "../shared/languages";
import { fetchBilingualCaptions } from "./captions";
import { PageLearningPanel } from "./learning-panel";
import { SubtitleOverlay } from "./overlay";
import { prefetchBatchPlan, type PrefetchBatchState } from "./prefetch";
import { CaptionPlaybackPosition } from "./playback-position";
import { shortcutFromEvent, shortcutsMatch } from "./shortcuts";
import { findSentenceIndex, navigationTargetIndex, type NavigationDirection } from "./navigation";
import { requestSubtitleTranslation } from "../shared/subtitle-translation";
import { getSettings, updateSettings } from "../shared/settings";
import { ANALYSIS_QUERY_KEY } from "../shared/analysis-stream";
import { normalizeDictionaryWord } from "../shared/dictionary-lookup";
import type {
  CaptionSentence,
  CaptionTrack,
  ExtensionSettings,
  TranscriptPanelSnapshot
} from "../shared/types";
import type { TranscriptCue } from "../shared/youtube-transcript";
import { cuesToSentences } from "./captions";

let settings: ExtensionSettings;
let sentences: CaptionSentence[] = [];
let activeIndex = -1;
let captionLanguage = "";
let latestTracks: CaptionTrack[] = [];
let captionVideoId: string | null = null;
let finishedVideo: HTMLVideoElement | undefined;
let loadVersion = 0;
let pausedByHover = false;
let lastLayoutUpdate = 0;
let captionSession: AbortController | undefined;
let observedCaptionButton: HTMLButtonElement | null = null;
let captionButtonObserver: MutationObserver | undefined;
let panelLayoutFrame: number | undefined;
let unavailableSubtitleTimer: number | undefined;
let transcriptLoading = false;
let transcriptError = "";
const playbackPosition = new CaptionPlaybackPosition();
let positionPending = false;
const translations = new Map<string, string>();
const officialTranslations = new Map<string, string>();
const translationErrors = new Map<string, string>();
const pendingTranslations = new Map<string, Promise<string>>();
const prefetchStateByProvider = new Map<ExtensionSettings["provider"], PrefetchBatchState>();
let accountPrefetchRetry: { signal: AbortSignal; indexes: number[] } | undefined;
type PrefetchItem = { sentence: CaptionSentence; provider: ExtensionSettings["provider"]; signal: AbortSignal; version: number };
const prefetchQueue = new PrefetchQueue<PrefetchItem>({
  async run(item) {
    if (item.signal.aborted || item.signal !== captionSession?.signal || !isCurrentCaptionLoad(item.version)) return;
    await getSentenceTranslation(item.sentence, item.provider);
  },
  onError(item, error) {
    if (item.signal.aborted || !isCurrentCaptionLoad(item.version)) return;
    translationErrors.set(item.sentence.id, errorMessage(error));
    learningPanel.setTranslation(item.sentence.id, undefined, errorMessage(error));
  },
  onIdle() {
    if (resumeAccountPrefetch()) return;
    if (activeIndex >= 0) scheduleTranslationPrefetch(activeIndex);
  },
});

// Let cancelled tasks release their queue slots before planning the new
// account's window; otherwise their old keys make the new window skip rows.
function resumeAccountPrefetch(): boolean {
  if (!accountPrefetchRetry) return false;
  if (!prefetchQueue.idle) return true;
  const retry = accountPrefetchRetry;
  accountPrefetchRetry = undefined;
  if (retry.signal !== captionSession?.signal) return false;
  prefetchStateByProvider.clear();
  if (activeIndex >= 0) scheduleTranslationPrefetch(activeIndex);
  prefetchCaptionIndexes(retry.indexes, true);
  return true;
}

const nativeCaptionStyle = document.createElement("style");
nativeCaptionStyle.id = "tubetitle-hide-native-captions";
nativeCaptionStyle.textContent = ".ytp-caption-window-container{display:none!important}";

function videoElement(): HTMLVideoElement | null {
  return document.querySelector("video.html5-main-video, video");
}

function isReviewingFinishedVideo(video = videoElement()): boolean {
  return Boolean(settings?.enabled && video?.ended && video === finishedVideo);
}

function watchVideoId(url = location.href): string | null {
  const page = new URL(url);
  return page.hostname === "www.youtube.com" && page.pathname === "/watch" ? page.searchParams.get("v") : null;
}

function currentVideoTitle(): string {
  const heading = document.querySelector<HTMLElement>("ytd-watch-metadata h1 yt-formatted-string, #title h1 yt-formatted-string");
  const title = heading?.textContent?.trim() || document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
  return title || "双语字幕";
}

function transcriptSnapshot(video = videoElement()): TranscriptPanelSnapshot {
  return {
    videoId: captionVideoId ?? "",
    videoTitle: currentVideoTitle(),
    sentences: sentences.map((sentence) => ({
      ...sentence,
      translationSkipped: skipSentenceTranslation(sentence),
      translation: officialTranslations.get(sentence.id) || translations.get(translationKey(sentence, settings.provider)),
      translationError: translationErrors.get(sentence.id)
    })),
    activeIndex,
    currentTimeMs: (video?.currentTime ?? 0) * 1000,
    durationMs: Number.isFinite(video?.duration) ? (video?.duration ?? 0) * 1000 : 0,
    loading: transcriptLoading,
    positionPending,
    error: transcriptError || undefined
  };
}

function publishTranscriptSnapshot(): void {
  if (!settings) return;
  learningPanel.setSnapshot(transcriptSnapshot());
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
    openDictionary(word);
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

const learningPanel = new PageLearningPanel({
  onHistorySeek: (videoId, startMs) => {
    const action = historyNavigationAction({ videoId, startMs }, new URL(location.href).searchParams.get("v"));
    if (action?.type === "navigate") location.assign(action.url);
    else if (action?.type === "seek") {
      const video = videoElement();
      if (!video) return;
      video.currentTime = Number.isFinite(video.duration) ? Math.min(action.seconds, video.duration) : action.seconds;
      void video.play().catch(() => undefined);
    }
  },
  onSeek: (index) => seekTo(index),
  onStudy: (videoId, id) => void studySentenceTranslation(videoId, id),
  onPrefetch: (indexes) => prefetchCaptionIndexes(indexes)
});

function applySettings(): void {
  syncYouTubeCaptionVisibility();
  overlay.setEnabled(Boolean(captionSession));
  overlay.setChineseVisible(settings.showChinese);
  overlay.setAppearance(settings.subtitleAppearance);
  overlay.setPosition(settings.subtitlePosition);
  syncNativeCaptionStyle();
  if (!positionPending && settings.showChinese && activeIndex >= 0) void translateSentence(sentences[activeIndex]!);
}

function requestTranscript(videoId: string, languageCode?: string): Promise<TranscriptCue[]> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      document.removeEventListener("tubitle:transcript", onResponse);
      reject(new Error("读取 YouTube 文字稿超时"));
    }, 25_000);
    const onResponse = (event: Event): void => {
      const detail = (event as CustomEvent<{
        requestId?: string;
        videoId?: string;
        cues?: TranscriptCue[];
        error?: string;
      }>).detail;
      if (detail?.requestId !== requestId || detail.videoId !== videoId) return;
      window.clearTimeout(timeout);
      document.removeEventListener("tubitle:transcript", onResponse);
      if (detail.error) reject(new Error(detail.error));
      else resolve(detail.cues ?? []);
    };
    document.addEventListener("tubitle:transcript", onResponse);
    document.dispatchEvent(new CustomEvent("tubitle:request-transcript", {
      detail: { requestId, videoId, languageCode }
    }));
  });
}

function resetCaptionData(): void {
  ++loadVersion;
  captionLanguage = "";
  window.clearTimeout(unavailableSubtitleTimer);
  unavailableSubtitleTimer = undefined;
  sentences = [];
  activeIndex = -1;
  translations.clear();
  officialTranslations.clear();
  translationErrors.clear();
  prefetchQueue.clear();
  prefetchStateByProvider.clear();
  overlay.hideSentence();
  overlay.clearStatus();
  transcriptLoading = false;
  transcriptError = "";
}

function syncCaptionVideo(): string | null {
  const videoId = watchVideoId();
  if (videoId === captionVideoId) return videoId;
  captionVideoId = videoId;
  playbackPosition.reset(location.href);
  positionPending = playbackPosition.pending;
  finishedVideo = undefined;
  latestTracks = [];
  pausedByHover = false;
  stopCaptionSession();
  resetCaptionData();
  transcriptLoading = Boolean(videoId);
  learningPanel.setVisible(false);
  overlay.setEnabled(false);
  syncNativeCaptionStyle();
  publishTranscriptSnapshot();
  return videoId;
}

function isCurrentCaptionLoad(version: number): boolean {
  return version === loadVersion && captionVideoId === watchVideoId();
}

async function loadTracks(tracks: CaptionTrack[], pageUrl = location.href): Promise<void> {
  const videoId = syncCaptionVideo();
  if (!settings || !videoId || watchVideoId(pageUrl) !== videoId) return;
  latestTracks = tracks;
  resetCaptionData();
  const version = loadVersion;
  transcriptLoading = true;
  applySettings();
  publishTranscriptSnapshot();
  try {
    let loaded;
    try {
      loaded = await fetchBilingualCaptions(tracks, settings, (languageCode) => requestTranscript(videoId, languageCode));
    } catch (captionError) {
      if (!isCurrentCaptionLoad(version)) return;
      try {
        const transcript = await requestTranscript(videoId);
        const fallbackSentences = cuesToSentences(transcript);
        if (fallbackSentences.length === 0) throw new Error("YouTube 文字稿为空");
        loaded = { sentences: fallbackSentences, officialTranslations: new Map<string, string>(), sourceLanguage: "" };
      } catch (transcriptError) {
        const primary = errorMessage(captionError);
        const fallback = errorMessage(transcriptError);
        throw new Error(`${primary}；文字稿回退失败：${fallback}`);
      }
    }
    if (!isCurrentCaptionLoad(version)) return;
    captionLanguage = loaded.sourceLanguage ?? "";
    sentences = loaded.sentences;
    for (const [id, translation] of loaded.officialTranslations) {
      const sentence = sentences.find((item) => item.id === id);
      if (sentence && !shouldSkipTranslation(sourceLanguage(sentence.text, captionLanguage), settings)) officialTranslations.set(id, translation);
    }
    transcriptLoading = false;
    applySettings();
    overlay.clearStatus();
    // Publish the loaded transcript at its current position, rather than briefly
    // exposing the top of the list to viewport prefetch before the next tick.
    const video = videoElement();
    if (captionSession && !positionPending && video && !video.seeking && video.readyState >= 2 &&
        !document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting")) {
      activateSentence(findSentenceIndex(sentences, video.currentTime * 1000));
    }
    publishTranscriptSnapshot();
  } catch (error) {
    if (!isCurrentCaptionLoad(version)) return;
    const detail = errorMessage(error);
    console.warn("[Tubetitle] 字幕加载失败", { videoUrl: pageUrl, detail, error });
    const notice = captionErrorNotice(detail);
    transcriptLoading = false;
    transcriptError = notice;
    overlay.showStatus(notice, true);
    publishTranscriptSnapshot();
    unavailableSubtitleTimer = window.setTimeout(() => {
      if (!isCurrentCaptionLoad(version)) return;
      overlay.clearStatus();
      overlay.hideSentence();
      unavailableSubtitleTimer = undefined;
    }, CAPTION_NOTICE_DURATION_MS);
  }
}

function skipSentenceTranslation(sentence: CaptionSentence): boolean {
  return shouldSkipTranslation(sourceLanguage(sentence.text, captionLanguage), settings);
}

function translationKey(sentence: CaptionSentence, provider: ExtensionSettings["provider"]): string {
  return `${loadVersion}:${provider}:${settings.targetLanguage}:${sentence.id}`;
}

async function getSentenceTranslation(
  sentence: CaptionSentence,
  provider: ExtensionSettings["provider"],
  userRequested = false
): Promise<string> {
  const signal = captionSession?.signal;
  if (!signal || (!userRequested && positionPending) || captionVideoId !== watchVideoId() || skipSentenceTranslation(sentence)) return "";
  const version = loadVersion;
  const target = settings.targetLanguage;
  const official = officialTranslations.get(sentence.id);
  if (official) return official;
  const key = translationKey(sentence, provider);
  const cached = translations.get(key);
  if (cached) return cached;
  const pending = pendingTranslations.get(key);
  if (pending) return pending;

  const request = requestSubtitleTranslation({
    type: "TRANSLATE",
    text: sentence.text,
    sourceLanguage: sourceLanguage(sentence.text, captionLanguage),
    provider,
    priority: userRequested || sentence.id === sentences[activeIndex]?.id ? "current" : "prefetch"
  }, signal).then((translation) => {
    if (signal.aborted || !isCurrentCaptionLoad(version) || target !== settings.targetLanguage) return "";
    translation = decodeTextEntities(translation);
    translations.set(key, translation);
    translationErrors.delete(sentence.id);
    learningPanel.setTranslation(sentence.id, translation);
    return translation;
  }).finally(() => {
    if (pendingTranslations.get(key) === request) pendingTranslations.delete(key);
  });
  pendingTranslations.set(key, request);
  return request;
}

async function translateSentence(sentence: CaptionSentence): Promise<void> {
  const signal = captionSession?.signal;
  if (!signal) return;
  if (skipSentenceTranslation(sentence)) {
    overlay.showTranslation(sentence.id, "");
    return;
  }
  const provider = settings.provider;
  const version = loadVersion;
  const target = settings.targetLanguage;
  try {
    const translation = await getSentenceTranslation(sentence, provider);
    if (signal.aborted || !isCurrentCaptionLoad(version) || target !== settings.targetLanguage) return;
    translationErrors.delete(sentence.id);
    learningPanel.setTranslation(sentence.id, translation);
    if (settings.showChinese && (provider === settings.provider || officialTranslations.has(sentence.id))) {
      overlay.showTranslation(sentence.id, translation);
    }
  } catch (error) {
    if (signal.aborted || !isCurrentCaptionLoad(version) || target !== settings.targetLanguage) return;
    const message = errorMessage(error);
    if (message === '今日匿名双语翻译额度已用完，请登录Tubitle开启更高额度') prefetchQueue.clear(false);
    translationErrors.set(sentence.id, message);
    learningPanel.setTranslation(sentence.id, undefined, message);
    if (settings.showChinese) overlay.showTranslationError(sentence.id, message);
  }
}

function scheduleTranslationPrefetch(currentIndex: number): void {
  if (!captionSession || positionPending || isReviewingFinishedVideo()) return;
  const provider = settings.provider;
  const previous = prefetchStateByProvider.get(provider);
  const plan = prefetchBatchPlan(currentIndex, sentences.length, previous, { busy: !prefetchQueue.idle });
  if (plan.reset) prefetchQueue.clear(false);
  prefetchStateByProvider.set(provider, plan.state);
  prefetchCaptionIndexes(plan.indexes, true);
}

function prefetchCaptionIndexes(indexes: number[], planned = false): void {
  if (!captionSession || positionPending || isReviewingFinishedVideo()) return;
  const provider = settings.provider;
  const window = prefetchStateByProvider.get(provider);
  for (const index of new Set(indexes)) {
    // Scrolling the panel must not silently grow the playback prefetch window.
    // A user can still explicitly translate any sentence using its study button.
    if (!planned && (!window || index < activeIndex || index >= window.cursor)) continue;
    const sentence = sentences[index];
    if (!sentence || skipSentenceTranslation(sentence) || officialTranslations.has(sentence.id)) continue;
    if (!planned && translationErrors.has(sentence.id)) continue;
    const key = translationKey(sentence, provider);
    if (translations.has(key) || pendingTranslations.has(key) || prefetchQueue.has(key)) continue;
    if (!prefetchQueue.add(key, { sentence, provider, signal: captionSession.signal, version: loadVersion })) break;
  }
}

async function studySentenceTranslation(videoId: string, id: string): Promise<void> {
  const signal = captionSession?.signal;
  if (!signal) return;
  if (!videoId || videoId !== captionVideoId || videoId !== watchVideoId()) return;
  const sentence = sentences.find((item) => item.id === id);
  if (!sentence) return;
  const version = loadVersion;
  try {
    const translation = await getSentenceTranslation(sentence, settings.provider, true);
    if (signal.aborted || !isCurrentCaptionLoad(version)) return;
    learningPanel.studyTranslation({
      videoId, sentence, translation: translation || undefined, error: translation ? undefined : "这句没有可保存的译文"
    });
  } catch (error) {
    if (!signal.aborted && isCurrentCaptionLoad(version)) learningPanel.studyTranslation({ videoId, sentence, error: errorMessage(error) });
  }
}

async function analyzeCurrentSentence(): Promise<void> {
  if (!captionSession) return;
  const sentence = sentences[activeIndex];
  if (!sentence) return;
  try {
    await chrome.storage.local.set({
      [ANALYSIS_QUERY_KEY]: {
        sentence: sentence.text,
        videoId: new URL(location.href).searchParams.get("v") ?? undefined,
        videoTitle: document.title.replace(/ - YouTube$/, ""),
        startMs: sentence.startMs,
        requestId: crypto.randomUUID(),
        createdAt: Date.now()
      }
    });
    learningPanel.openTab("analysis");
  } catch (error) {
    overlay.showStatus(errorMessage(error), true);
  }
}

function openDictionary(value: string): void {
  if (!captionSession) return;
  const word = normalizeDictionaryWord(value);
  if (word) learningPanel.lookupWord(word);
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
  if (!sentence || !video || (!captionSession && !isReviewingFinishedVideo(video))) return;
  video.currentTime = sentence.startMs / 1000 + 0.01;
  if (captionSession) activateSentence(index);
  void video.play().catch(() => undefined);
}

function seekRelative(direction: NavigationDirection): void {
  const video = videoElement();
  if (!video) return;
  const targetIndex = navigationTargetIndex(sentences, video.currentTime * 1000, direction);
  if (targetIndex >= 0) seekTo(targetIndex, video);
}

function handleShortcut(event: KeyboardEvent): void {
  if (!captionSession || event.repeat) return;
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

function schedulePanelLayoutUpdate(): void {
  if (panelLayoutFrame !== undefined) return;
  panelLayoutFrame = window.requestAnimationFrame(() => {
    panelLayoutFrame = undefined;
    const video = videoElement();
    if (!video || document.fullscreenElement) return;
    const reviewing = isReviewingFinishedVideo(video);
    if (captionSession || reviewing) learningPanel.updateLayout(video.getBoundingClientRect(), reviewing);
  });
}

function syncNativeCaptionStyle(): void {
  if (captionSession && sentences.length) {
    if (!nativeCaptionStyle.isConnected) document.documentElement.append(nativeCaptionStyle);
  } else {
    nativeCaptionStyle.remove();
  }
}

function stopCaptionSession(): void {
  captionSession?.abort();
  captionSession = undefined;
  pendingTranslations.clear();
  prefetchQueue.clear();
  prefetchStateByProvider.clear();
  activeIndex = -1;
}

function syncYouTubeCaptionVisibility(): void {
  const videoId = syncCaptionVideo();
  const button = settings?.enabled && videoId && videoElement()
    ? document.querySelector<HTMLButtonElement>("#movie_player .ytp-subtitles-button")
    : null;
  if (button !== observedCaptionButton) {
    captionButtonObserver?.disconnect();
    observedCaptionButton = button;
    if (button) {
      captionButtonObserver ??= new MutationObserver(syncYouTubeCaptionVisibility);
      captionButtonObserver.observe(button, { attributes: true, attributeFilter: ["aria-pressed", "disabled", "aria-disabled"] });
    }
  }
  const visible = !button?.disabled && button?.getAttribute("aria-disabled") !== "true" &&
    button?.getAttribute("aria-pressed") === "true";
  if (Boolean(captionSession) === visible) return;
  if (visible) {
    captionSession = new AbortController();
    lastLayoutUpdate = -Infinity;
  } else {
    stopCaptionSession();
    overlay.hideSentence();
  }
  syncNativeCaptionStyle();
  overlay.setEnabled(visible);
  overlay.setCaptionsVisible(visible);
  learningPanel.setVisible((visible || isReviewingFinishedVideo()) && !document.fullscreenElement);
  if (!visible && pausedByHover) {
    pausedByHover = false;
    if (settings.resumeAfterHover) void videoElement()?.play().catch(() => undefined);
  }
  // A load attempted with CC off could not use the player's transcript panel.
  if (visible && transcriptError && !sentences.length) void loadTracks(latestTracks);
}

function finishCaptionPlayback(event: Event): void {
  const video = videoElement();
  if (!settings?.enabled || !captionSession || !sentences.length || !video?.ended || event.target !== video ||
      !captionVideoId || captionVideoId !== watchVideoId() ||
      document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting")) return;

  // Keep this video on screen before YouTube handles the end event and advances.
  event.stopImmediatePropagation();
  learningPanel.setPlaybackActive(false);
  finishedVideo = video;
  pausedByHover = false;
  video.pause();
  activateSentence(-1);
  lastLayoutUpdate = -Infinity;
  learningPanel.setActive(-1, video.currentTime * 1000, Number.isFinite(video.duration) ? video.duration * 1000 : 0);
  learningPanel.setVisible(!document.fullscreenElement);
  learningPanel.openTab("subtitles");
  if (document.fullscreenElement?.contains(video)) void document.exitFullscreen().catch(() => undefined);
}

const playbackActivity = new PlaybackActivity((activity) => {
  void chrome.runtime.sendMessage({ type: "LEARNING_ACTIVITY", activity })?.catch(() => undefined);
});
window.addEventListener("pagehide", () => playbackActivity.flush());

function tick(timestamp: number): void {
  syncYouTubeCaptionVisibility();
  const video = videoElement();
  const reviewing = isReviewingFinishedVideo(video);
  if (!video?.ended || video !== finishedVideo) finishedVideo = undefined;
  const panelVisible = Boolean((captionSession || reviewing) && !document.fullscreenElement);
  learningPanel.setVisible(panelVisible);
  if (captionSession || reviewing) {
    if (video) {
      const wasPending = positionPending;
      positionPending = !reviewing && !playbackPosition.ready(video, timestamp,
        Boolean(document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting")));
      if (captionSession && !reviewing && !positionPending) {
        activateSentence(findSentenceIndex(sentences, video.currentTime * 1000));
      }
      if (positionPending !== wasPending) publishTranscriptSnapshot();
      if (timestamp - lastLayoutUpdate >= 200) {
        const fullscreenParent = document.fullscreenElement;
        overlay.attachTo(fullscreenParent?.contains(video) ? fullscreenParent : document.documentElement);
        const bounds = video.getBoundingClientRect();
        overlay.updateVideoBounds(bounds);
        if (panelVisible) {
          learningPanel.updateLayout(bounds, reviewing);
          if (!positionPending) learningPanel.setActive(activeIndex, video.currentTime * 1000, Number.isFinite(video.duration) ? video.duration * 1000 : 0);
        }
        lastLayoutUpdate = timestamp;
      }
    }
  }
  learningPanel.setPlaybackActive(Boolean(panelVisible && video && !video.paused && !video.seeking && !video.ended &&
    video.playbackRate > 0 && video.readyState >= video.HAVE_FUTURE_DATA &&
    !video.closest(".ad-showing, .ad-interrupting")));
  playbackActivity.update({
    at: timestamp, position: (video?.currentTime ?? 0) * 1000, videoId: captionVideoId || "",
    sentenceId: sentences[activeIndex]?.id,
    playing: Boolean(captionSession && sentences.length > 0 && !positionPending && video && !video.paused && !video.seeking && !video.ended &&
      video.playbackRate > 0 && video.readyState >= video.HAVE_FUTURE_DATA &&
      !document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting")),
    rate: video?.playbackRate ?? 1,
  });
  requestAnimationFrame(tick);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

document.addEventListener("tubetitle:tracks", (event) => {
  const detail = (event as CustomEvent<{ tracks: CaptionTrack[]; url?: string }>).detail;
  if (detail?.tracks) void loadTracks(detail.tracks, detail.url);
});
document.addEventListener("yt-navigate-finish", syncCaptionVideo);
document.addEventListener("ended", finishCaptionPlayback, true);
for (const eventName of ["pause", "waiting", "seeking", "ended"]) {
  document.addEventListener(eventName, (event) => {
    if (event.target === videoElement()) learningPanel.setPlaybackActive(false);
  }, true);
}
window.addEventListener("popstate", syncCaptionVideo);
document.addEventListener("keydown", handleShortcut, true);
document.addEventListener("scroll", schedulePanelLayoutUpdate, { capture: true, passive: true });
window.addEventListener("resize", schedulePanelLayoutUpdate, { passive: true });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const accountChange = changes[SYNC_STATE_KEY];
  if (settings?.serviceMode === "tubitle" && accountChange?.oldValue?.account?.userId !== accountChange?.newValue?.account?.userId) {
    const failedIndexes = sentences.flatMap((sentence, index) => translationErrors.has(sentence.id) ? [index] : []);
    // Old anonymous requests must not put quota errors back after sign-in.
    const hadSession = Boolean(captionSession);
    captionSession?.abort();
    captionSession = hadSession ? new AbortController() : undefined;
    pendingTranslations.clear();
    prefetchQueue.clear();
    prefetchStateByProvider.clear();
    translationErrors.clear();
    publishTranscriptSnapshot();
    if (captionSession && activeIndex >= 0) {
      overlay.showTranslation(sentences[activeIndex]!.id, "");
      void translateSentence(sentences[activeIndex]!);
      accountPrefetchRetry = { signal: captionSession.signal, indexes: failedIndexes };
      resumeAccountPrefetch();
    }
  }
  if (!changes.settings) return;
  void getSettings().then((next) => {
    const languagesChanged = settings.targetLanguage !== next.targetLanguage || JSON.stringify(settings.excludedLanguages) !== JSON.stringify(next.excludedLanguages);
    const localModeChanged = (settings.provider === "hy-mt-local") !== (next.provider === "hy-mt-local");
    const connectionChanged =
      settings.provider !== next.provider ||
      settings.microsoftTranslatorKey !== next.microsoftTranslatorKey ||
      settings.microsoftTranslatorRegion !== next.microsoftTranslatorRegion ||
      settings.microsoftTranslatorEndpoint !== next.microsoftTranslatorEndpoint ||
      settings.googleTranslateApiKey !== next.googleTranslateApiKey ||
      settings.tencentSecretId !== next.tencentSecretId ||
      settings.tencentSecretKey !== next.tencentSecretKey ||
      settings.tencentRegion !== next.tencentRegion ||
      settings.tencentConcurrency !== next.tencentConcurrency;
    if (connectionChanged) {
      prefetchQueue.clear();
      prefetchStateByProvider.clear();
      translationErrors.clear();
    }
    settings = next;
    syncCaptionVideo();
    if (languagesChanged || localModeChanged) { void loadTracks(latestTracks); return; }
    applySettings();
    publishTranscriptSnapshot();
    if (connectionChanged && activeIndex >= 0) scheduleTranslationPrefetch(activeIndex);
  });
});

initializeI18n();
subscribeUiLanguage(() => {
  overlay.localize();
  learningPanel.localize();
});
void getSettings().then((loaded) => {
  settings = loaded;
  applySettings();
  document.dispatchEvent(new CustomEvent("tubetitle:request-tracks"));
  requestAnimationFrame(tick);
});
