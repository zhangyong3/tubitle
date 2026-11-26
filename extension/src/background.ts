import { readAnalysisResponse } from "./shared/read-analysis";
import { requestSentenceAnalysis } from "./analysis-provider";
import { requireTranscriptPdfAccess, AnalysisAccessError, recordLearningActivity, enqueueLearning, flushLearning, syncStatus, getAccountTranslationSelection, requestAccountTranslation, type AccountTranslationSelection } from "./learning-sync";
import { pruneSidebarHistory } from "./shared/sidebar-history";
import { SYNC_ALARM } from "./shared/learning-sync";
import { sourceLanguage, shouldSkipTranslation } from "./shared/languages";
import { getSettings, updateSettings } from "./shared/settings";
import type { ExtensionMessage, MessageResponse, TranslationProvider } from "./shared/types";
import { ANALYSIS_QUERY_KEY } from "./shared/analysis-stream";
import { cacheTranslation, getCachedTranslation } from "./background-cache";
import { getTubitleModel, MicrosoftRateLimitError, requestAnalysis, translateLocally } from "./local-providers";
import { SmoothRateLimit } from "./shared/smooth-rate-limit";
import { SUBTITLE_TRANSLATION_PORT, type SubtitleTranslationRequest } from "./shared/subtitle-translation";
import { tubitleConnection } from "./shared/tubitle-connection";

interface TranslationJob {
  key?: string; text: string; provider: TranslationProvider;
  priority: "current" | "prefetch";
  settings: Awaited<ReturnType<typeof getSettings>>; source: string;
  signal?: AbortSignal; expectedModel?: string;
  accountSelection?: AccountTranslationSelection;
  resolve: (value: string) => void; reject: (error: unknown) => void;
}

const memoryCache = new Map<string, string>();
interface PendingTranslation {
  promise: Promise<string>; controller: AbortController; consumers: number;
  complete: boolean; priority: "current" | "prefetch"; job?: TranslationJob;
}
const pending = new Map<string, PendingTranslation>();
const cacheWrites = new Map<string, Promise<void>>();
const MAX_MEMORY_TRANSLATIONS = 1000;

function rememberTranslation(key: string, value: string): void {
  memoryCache.delete(key);
  memoryCache.set(key, value);
  if (memoryCache.size > MAX_MEMORY_TRANSLATIONS) memoryCache.delete(memoryCache.keys().next().value!);
}

async function persistTranslation(key: string, value: string): Promise<void> {
  let write = cacheWrites.get(key);
  if (!write) {
    write = cacheTranslation(key, value).catch(() => {
      throw Object.assign(new Error('译文已获取，但本地缓存写入失败，请检查浏览器存储后重试'), { status: 507 });
    }).finally(() => { cacheWrites.delete(key); });
    cacheWrites.set(key, write);
  }
  await write;
}

function joinTranslation(group: PendingTranslation, signal?: AbortSignal): Promise<string> {
  group.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      group.consumers--;
      if (!group.consumers && !group.complete) group.controller.abort();
      done();
    };
    const abort = () => finish(() => reject(signal?.reason));
    signal?.addEventListener('abort', abort, { once: true });
    group.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal?.aborted) abort();
  });
}

function promoteTranslation(group: PendingTranslation, priority: "current" | "prefetch"): void {
  if (priority !== 'current' || group.priority === 'current') return;
  group.priority = 'current';
  if (!group.job) return;
  group.job.priority = 'current';
  const index = queue.indexOf(group.job);
  if (index >= 0) { queue.splice(index, 1); queue.unshift(group.job); void drainTranslationQueue(); }
}
const queue: TranslationJob[] = [];
let activeTranslations = 0;
let localActiveTranslations = 0;
let microsoftActive = false;
let microsoftNextRequestAt = 0;
let microsoftBlockedUntil = 0;
const MICROSOFT_MIN_INTERVAL_MS = 250;
// Leave headroom under the F0 guideline of roughly 33,300 characters per minute.
const MICROSOFT_CHARACTERS_PER_SECOND = 400;
const MICROSOFT_RETRY_BUDGET_MS = 10_000;
const TENCENT_REQUEST_INTERVAL_MS = 240;
const LOCAL_TRANSLATION_SLOTS = 3;
const tencentRateLimit = new SmoothRateLimit(TENCENT_REQUEST_INTERVAL_MS);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

function translationErrorDetails(error: unknown): { status?: number; retryAfterMs?: number } {
  if (!error || typeof error !== 'object') return {};
  const detail = error as { status?: number; retryAfterMs?: number };
  return {
    ...(typeof detail.status === 'number' && Number.isFinite(detail.status) ? { status: detail.status } : {}),
    ...(typeof detail.retryAfterMs === 'number' && Number.isFinite(detail.retryAfterMs) ? { retryAfterMs: detail.retryAfterMs } : {}),
  };
}

function translationKey(provider: string, text: string, source: string, target: string): string {
  return `${provider}\0${source || "auto"}\0${target}\0${text}`;
}

async function waitForDelay(delay: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (delay <= 0) return;
  await new Promise<void>((resolve, reject) => {
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function waitForTencentSlot(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const delay = tencentRateLimit.reserve();
  await waitForDelay(delay, signal);
}

async function runMicrosoftTranslation(job: TranslationJob): Promise<string> {
  if (Date.now() < microsoftBlockedUntil) {
    throw new MicrosoftRateLimitError(microsoftBlockedUntil - Date.now());
  }
  const interval = Math.max(MICROSOFT_MIN_INTERVAL_MS, Math.ceil(job.text.length * 1000 / MICROSOFT_CHARACTERS_PER_SECOND));
  let retryWait = 0;
  for (let attempt = 0; ; attempt += 1) {
    const delay = microsoftNextRequestAt - Date.now();
    if (delay > 0) await waitForDelay(delay, job.signal);
    job.signal?.throwIfAborted();
    microsoftNextRequestAt = Date.now() + interval;
    try {
      return await translateLocally(job.provider, job.text, job.settings, job.source, job.signal);
    } catch (error) {
      job.signal?.throwIfAborted();
      if (!(error instanceof MicrosoftRateLimitError)) throw error;
      const wait = Math.max(1500 * 2 ** attempt, error.retryAfterMs);
      const now = Date.now();
      microsoftNextRequestAt = Math.max(microsoftNextRequestAt, now + wait);
      retryWait += microsoftNextRequestAt - now;
      if (attempt >= 2 || retryWait > MICROSOFT_RETRY_BUDGET_MS) {
        // A sustained limit should not start another retry loop for every queued subtitle.
        microsoftBlockedUntil = Math.max(microsoftNextRequestAt, now + 15_000);
        throw error;
      }
    }
  }
}

function isTencentRateLimit(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("frequency limit") || message.includes("requestlimitexceeded") || message.includes("请求过于频繁");
}

async function runTranslation(job: TranslationJob): Promise<string> {
  if (job.settings.serviceMode === "tubitle") {
    const selection = job.accountSelection ?? await getAccountTranslationSelection();
    return requestAccountTranslation(job.text, job.source, job.settings.targetLanguage, selection, job.signal);
  }
  if (job.provider === "microsoft") return runMicrosoftTranslation(job);
  const attempts = job.provider === "tencent" ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (job.provider === "tencent") await waitForTencentSlot(job.signal);
    job.signal?.throwIfAborted();
    try {
      return await translateLocally(job.provider, job.text, job.settings, job.source, job.signal, job.expectedModel);
    } catch (error) {
      job.signal?.throwIfAborted();
      if (!isTencentRateLimit(error) || attempt === attempts - 1) throw error;
      await waitForDelay(600 * (attempt + 1), job.signal);
    }
  }
  throw new Error("翻译请求失败");
}

async function enqueueTranslation(text: string, provider: TranslationProvider, priority: "current" | "prefetch" = "prefetch", trackLanguage = "", signal?: AbortSignal, purpose?: "dictionary"): Promise<string> {
  const settings = await getSettings();
  provider = settings.provider;
  signal?.throwIfAborted();
  const source = sourceLanguage(text, trackLanguage);
  if (purpose !== "dictionary" && shouldSkipTranslation(source, settings)) return "";
  const accountSelection = settings.serviceMode === "tubitle" ? await getAccountTranslationSelection() : undefined;
  const expectedModel = !accountSelection && provider === "hy-mt-local" ? await getTubitleModel(settings) : undefined;
  signal?.throwIfAborted();
  const cacheProvider = accountSelection ? `account:${accountSelection.userId}:${accountSelection.revision}`
    : expectedModel ? `${provider}:${tubitleConnection(settings).origin}:${expectedModel}` : provider;
  const key = translationKey(cacheProvider, text, source, settings.targetLanguage);
  const memory = memoryCache.get(key);
  if (memory) {
    rememberTranslation(key, memory);
    await persistTranslation(key, memory);
    signal?.throwIfAborted();
    return memory;
  }
  let existing = pending.get(key);
  if (existing && !existing.controller.signal.aborted) {
    promoteTranslation(existing, priority);
    return joinTranslation(existing, signal);
  }
  let disk: string | undefined;
  try { disk = await getCachedTranslation(key); }
  catch { throw Object.assign(new Error('无法读取本地翻译缓存，请检查浏览器存储后重试'), { status: 507 }); }
  signal?.throwIfAborted();
  if (disk) { rememberTranslation(key, disk); return disk; }
  existing = pending.get(key);
  if (existing && !existing.controller.signal.aborted) {
    promoteTranslation(existing, priority);
    return joinTranslation(existing, signal);
  }
  const controller = new AbortController();
  const group: PendingTranslation = {
    controller, consumers: 0, complete: false, priority,
    promise: Promise.resolve().then(() => scheduleTranslation({ key, text, provider, priority: group.priority, settings, source, signal: controller.signal, expectedModel, accountSelection }, job => { group.job = job; }))
      .finally(() => {
        group.complete = true;
        if (pending.get(key) === group) pending.delete(key);
      }),
  };
  pending.set(key, group);
  return joinTranslation(group, signal);
}

function scheduleTranslation(input: Omit<TranslationJob, "resolve" | "reject">, onQueued?: (job: TranslationJob) => void): Promise<string> {
  const signal = input.signal;
  let abort: (() => void) | undefined;
  return new Promise<string>((resolve, reject) => {
    signal?.throwIfAborted();
    const job: TranslationJob = { ...input, resolve, reject };
    onQueued?.(job);
    abort = () => {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (job.priority === "current") queue.unshift(job); else queue.push(job);
    void drainTranslationQueue();
  }).finally(() => { if (abort) signal?.removeEventListener("abort", abort); });
}

async function drainTranslationQueue(): Promise<void> {
  const settings = await getSettings();
  const limit = Math.min(8, Math.max(1, settings.provider === "tencent" ? settings.tencentConcurrency : 6));
  for (;;) {
    const index = queue.findIndex((job) => {
      if (job.provider === "microsoft") return !microsoftActive;
      if (job.provider === "hy-mt-local") {
        // Reserve one model slot for a subtitle that is already on screen.
        return localActiveTranslations < LOCAL_TRANSLATION_SLOTS - (job.priority === "prefetch" ? 1 : 0);
      }
      return activeTranslations < limit;
    });
    if (index < 0) return;
    const [job] = queue.splice(index, 1) as [TranslationJob];
    const microsoft = job.provider === "microsoft";
    const local = job.provider === "hy-mt-local";
    if (microsoft) microsoftActive = true;
    else if (local) localActiveTranslations += 1;
    else activeTranslations += 1;
    void runTranslation(job).then(async (translation) => {
      job.signal?.throwIfAborted();
      if (job.key !== undefined) {
        rememberTranslation(job.key, translation);
        await persistTranslation(job.key, translation);
      }
      job.resolve(translation);
    }).catch(job.reject).finally(() => {
      if (microsoft) microsoftActive = false;
      else if (local) localActiveTranslations -= 1;
      else activeTranslations -= 1;
      void drainTranslationQueue();
    });
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse: (response: MessageResponse) => void) => {
  void (async () => {
    try {
      if (message.type.startsWith("LEARNING_SYNC_")) {
        const extensionUrl = chrome.runtime.getURL("");
        if (_sender.id !== chrome.runtime.id || !_sender.url?.startsWith(extensionUrl)) throw new Error("仅允许插件内部页面操作账户同步");

      }
      switch (message.type) {
        case "LEARNING_ACTIVITY": await recordLearningActivity(message.activity); sendResponse({ ok: true, data: null }); break;
        case "CHECK_TRANSCRIPT_PDF_ACCESS": await requireTranscriptPdfAccess(); sendResponse({ ok: true, data: null }); break;
        case "LEARNING_SYNC_STATUS": sendResponse({ ok: true, data: await syncStatus() }); break;
        case "LEARNING_SYNC_ENQUEUE": await enqueueLearning(message.record); sendResponse({ ok: true, data: null }); break;
        case "GET_SETTINGS": sendResponse({ ok: true, data: await getSettings() }); break;
        case "UPDATE_SETTINGS": sendResponse({ ok: true, data: await updateSettings(message.settings) }); break;
        case "TRANSLATE": sendResponse({ ok: true, data: await enqueueTranslation(message.text, message.provider, message.priority, message.sourceLanguage, undefined, message.purpose) }); break;
        case "TEST_PROVIDER": {
          const settings = await getSettings();
          if (message.provider === "llm") {
            const response = await requestAnalysis("This is a connection test.", settings);
            await response.body?.cancel();
          } else if (message.provider === "microsoft" || message.provider === "hy-mt-local") {
            await scheduleTranslation({ provider: message.provider, text: "This is a connection test.", priority: "current", settings, source: "" });
          } else {
            if (message.provider === "tencent") await waitForTencentSlot();
            await translateLocally(message.provider, "This is a connection test.", settings);
          }
          sendResponse({ ok: true, data: null });
          break;
        }
        case "OPEN_ANALYSIS": {
          const sentence = message.sentence.trim();
          if (!sentence) throw new Error("当前没有可解析的句子");
          await chrome.storage.local.set({ [ANALYSIS_QUERY_KEY]: { sentence, requestId: crypto.randomUUID(), createdAt: Date.now() } });
          sendResponse({ ok: true, data: null });
          break;
        }
      }
    } catch (error) { sendResponse({ ok: false, error: errorMessage(error) }); }
  })();
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === SUBTITLE_TRANSLATION_PORT) {
    const controller = new AbortController();
    let started = false;
    port.onDisconnect.addListener(() => controller.abort());
    function reply(response: MessageResponse<string>) {
      if (controller.signal.aborted) return;
      try { port.postMessage(response); } catch { controller.abort(); }
    }
    port.onMessage.addListener((message: SubtitleTranslationRequest) => {
      if (started || message.type !== "TRANSLATE") return;
      started = true;
      void enqueueTranslation(message.text, message.provider, message.priority, message.sourceLanguage, controller.signal, message.purpose)
        .then((data) => reply({ ok: true, data }), (error: unknown) => reply({ ok: false, error: errorMessage(error), ...translationErrorDetails(error) }));
    });
    return;
  }
  if (port.name !== "analysis-stream") return;
  if (port.sender?.id !== chrome.runtime.id || !port.sender.url?.startsWith(chrome.runtime.getURL(""))) { port.disconnect(); return; }
  let controller: AbortController | undefined;
  port.onDisconnect.addListener(() => controller?.abort());
  port.onMessage.addListener((message: { sentence?: string; requestId?: string }) => {
    if (!message.sentence || controller) return;
    controller = new AbortController();
    void streamAnalysis(message.sentence, message.requestId || crypto.randomUUID(), controller.signal, (payload) => port.postMessage(payload))
      .catch((error) => {
        if (controller?.signal.aborted) return;
        try { port.postMessage({ error: errorMessage(error), ...(error instanceof AnalysisAccessError ? { reason: error.reason, actionUrl: error.actionUrl } : {}) }); }
        catch { controller?.abort(); }
      })
      .finally(() => { try { port.disconnect(); } catch { /* already closed */ } });
  });
});

async function streamAnalysis(sentence: string, requestId: string, signal: AbortSignal, emit: (payload: { delta?: string; done?: boolean }) => void): Promise<void> {
  const response = await requestSentenceAnalysis(sentence, requestId, await getSettings(), signal);
  await readAnalysisResponse(response, (delta) => emit({ delta }), signal);
  emit({ done: true });
}

async function cleanHistory() {
  await pruneSidebarHistory((await getSettings()).historyRetentionDays);
}
async function scheduleLearningSync() {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create("history-retention", { periodInMinutes: 60 });
  await cleanHistory();
  await flushLearning();
}
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === SYNC_ALARM) void flushLearning().catch(() => undefined); });
chrome.runtime.onStartup.addListener(() => { void scheduleLearningSync().catch(() => undefined); });
chrome.runtime.onInstalled.addListener(() => { void scheduleLearningSync().catch(() => undefined); });
void scheduleLearningSync().catch(() => undefined);

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "history-retention") void cleanHistory().catch(() => undefined); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings && changes.settings.newValue?.historyRetentionDays !== changes.settings.oldValue?.historyRetentionDays) void cleanHistory().catch(() => undefined);
});
