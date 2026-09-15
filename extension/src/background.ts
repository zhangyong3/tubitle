import { getSettings, updateSettings } from "./shared/settings";
import type { ExtensionMessage, MessageResponse, TranslationProvider } from "./shared/types";
import { DICTIONARY_QUERY_KEY } from "./shared/offline-dictionary";
import { normalizeDictionaryWord } from "./shared/dictionary-lookup";
import { ANALYSIS_QUERY_KEY } from "./shared/analysis-stream";
import { cacheTranslation, getCachedTranslation } from "./background-cache";
import { requestAnalysis, translateLocally } from "./local-providers";
import { SmoothRateLimit } from "./shared/smooth-rate-limit";

interface TranslationJob {
  key: string; text: string; provider: TranslationProvider;
  priority: "current" | "prefetch";
  resolve: (value: string) => void; reject: (error: unknown) => void;
}

const memoryCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const queue: TranslationJob[] = [];
let activeTranslations = 0;
const TENCENT_REQUEST_INTERVAL_MS = 240;
const tencentRateLimit = new SmoothRateLimit(TENCENT_REQUEST_INTERVAL_MS);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

function translationKey(provider: TranslationProvider, text: string): string {
  return `${provider}\0en\0zh-Hans\0${text}`;
}

async function waitForTencentSlot(): Promise<void> {
  const delay = tencentRateLimit.reserve();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

function isTencentRateLimit(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("frequency limit") || message.includes("requestlimitexceeded") || message.includes("请求过于频繁");
}

async function runTranslation(job: TranslationJob, settings: Awaited<ReturnType<typeof getSettings>>): Promise<string> {
  const attempts = job.provider === "tencent" ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (job.provider === "tencent") await waitForTencentSlot();
    try {
      return await translateLocally(job.provider, job.text, settings);
    } catch (error) {
      if (!isTencentRateLimit(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw new Error("翻译请求失败");
}

async function enqueueTranslation(text: string, provider: TranslationProvider, priority: "current" | "prefetch" = "prefetch"): Promise<string> {
  const key = translationKey(provider, text);
  const memory = memoryCache.get(key);
  if (memory) return memory;
  const existing = pending.get(key);
  if (existing) return existing;
  const disk = await getCachedTranslation(key).catch(() => undefined);
  if (disk) { memoryCache.set(key, disk); return disk; }
  const pendingAfterCacheLookup = pending.get(key);
  if (pendingAfterCacheLookup) return pendingAfterCacheLookup;
  const promise = new Promise<string>((resolve, reject) => {
    const job = { key, text, provider, priority, resolve, reject } satisfies TranslationJob;
    if (priority === "current") queue.unshift(job); else queue.push(job);
    void drainTranslationQueue();
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

async function drainTranslationQueue(): Promise<void> {
  const settings = await getSettings();
  const limit = Math.min(8, Math.max(1, settings.provider === "tencent" ? settings.tencentConcurrency : 6));
  while (activeTranslations < limit && queue.length > 0) {
    const job = queue.shift()!;
    activeTranslations += 1;
    void runTranslation(job, settings).then((translation) => {
      memoryCache.set(job.key, translation);
      void cacheTranslation(job.key, translation).catch(() => undefined);
      job.resolve(translation);
    }).catch(job.reject).finally(() => {
      activeTranslations -= 1;
      void drainTranslationQueue();
    });
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse: (response: MessageResponse) => void) => {
  void (async () => {
    try {
      switch (message.type) {
        case "GET_SETTINGS": sendResponse({ ok: true, data: await getSettings() }); break;
        case "UPDATE_SETTINGS": sendResponse({ ok: true, data: await updateSettings(message.settings) }); break;
        case "TRANSLATE": sendResponse({ ok: true, data: await enqueueTranslation(message.text, message.provider, message.priority) }); break;
        case "TEST_PROVIDER": {
          const settings = await getSettings();
          if (message.provider === "llm") {
            const response = await requestAnalysis("This is a connection test.", settings);
            await response.body?.cancel();
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
        case "OPEN_DICTIONARY": {
          const word = normalizeDictionaryWord(message.word);
          if (!word) throw new Error("无法识别要查询的单词");
          if (message.offline) await chrome.storage.local.set({ [DICTIONARY_QUERY_KEY]: { word, requestId: crypto.randomUUID(), createdAt: Date.now() } });
          else await chrome.tabs.create({ url: `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}` });
          sendResponse({ ok: true, data: null });
          break;
        }
      }
    } catch (error) { sendResponse({ ok: false, error: errorMessage(error) }); }
  })();
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "analysis-stream") return;
  let controller: AbortController | undefined;
  port.onDisconnect.addListener(() => controller?.abort());
  port.onMessage.addListener((message: { sentence?: string }) => {
    if (!message.sentence || controller) return;
    controller = new AbortController();
    void streamAnalysis(message.sentence, controller.signal, (payload) => port.postMessage(payload))
      .catch((error) => port.postMessage({ error: errorMessage(error) }))
      .finally(() => { try { port.disconnect(); } catch { /* already closed */ } });
  });
});

async function streamAnalysis(sentence: string, signal: AbortSignal, emit: (payload: { delta?: string; done?: boolean }) => void): Promise<void> {
  const response = await requestAnalysis(sentence, await getSettings(), signal);
  if (!response.body) throw new Error("大模型没有返回可读数据流");
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("大模型返回了空结果");
    emit({ delta: content }); emit({ done: true }); return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = payload.choices?.[0]?.delta?.content;
      if (delta) emit({ delta });
    }
    if (done) break;
  }
  emit({ done: true });
}
