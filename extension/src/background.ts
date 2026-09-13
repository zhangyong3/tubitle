import { getSettings, updateSettings } from "./shared/settings";
import type {
  ExtensionMessage,
  MessageResponse,
  TranslationProvider
} from "./shared/types";
import { DICTIONARY_QUERY_KEY } from "./shared/offline-dictionary";
import { normalizeDictionaryWord } from "./shared/dictionary-lookup";
import { ANALYSIS_QUERY_KEY } from "./shared/analysis-stream";
import { authenticatedFetch, readJsonResponse } from "./shared/api-client";

const responseCache = new Map<string, unknown>();

interface PendingTranslation {
  text: string;
  resolve: (translation: string) => void;
  reject: (error: unknown) => void;
}

const pendingTranslationBatches = new Map<TranslationProvider, PendingTranslation[]>();
const translationBatchTimers = new Map<TranslationProvider, ReturnType<typeof setTimeout>>();
const runningTranslationBatches = new Set<TranslationProvider>();

async function callServer<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await authenticatedFetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await readJsonResponse<{
      error?: string;
      message?: string;
    }>(response);
    if (!response.ok) {
      throw new Error(payload.message || payload.error || `服务端请求失败 (${response.status})`);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("服务端响应超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

function translationCacheKey(provider: TranslationProvider, text: string): string {
  return `translate:${provider}:${text}`;
}

function scheduleTranslationBatch(provider: TranslationProvider, delay = 25): void {
  if (translationBatchTimers.has(provider) || runningTranslationBatches.has(provider)) return;
  translationBatchTimers.set(provider, setTimeout(() => {
    translationBatchTimers.delete(provider);
    void flushTranslationBatch(provider);
  }, delay));
}

async function flushTranslationBatch(provider: TranslationProvider): Promise<void> {
  if (runningTranslationBatches.has(provider)) return;
  const queue = pendingTranslationBatches.get(provider);
  if (!queue?.length) return;
  runningTranslationBatches.add(provider);
  const batch = queue.splice(0, 15);
  try {
    const result = await callServer<{ translations: string[] }>(
      "/api/translate/batch",
      { texts: batch.map((item) => item.text), from: "en", to: "zh-Hans", provider }
    );
    if (!Array.isArray(result.translations) || result.translations.length !== batch.length) {
      throw new Error("服务端返回的批量翻译数量不正确");
    }
    batch.forEach((item, index) => {
      const translation = result.translations[index]!;
      responseCache.set(translationCacheKey(provider, item.text), translation);
      item.resolve(translation);
    });
  } catch (error) {
    for (const item of batch) item.reject(error);
  } finally {
    runningTranslationBatches.delete(provider);
    if (queue.length > 0) scheduleTranslationBatch(provider, queue.length >= 15 ? 0 : 25);
  }
}

function enqueueTranslation(text: string, provider: TranslationProvider): Promise<string> {
  const cached = responseCache.get(translationCacheKey(provider, text));
  if (typeof cached === "string") return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const queue = pendingTranslationBatches.get(provider) ?? [];
    queue.push({ text, resolve, reject });
    pendingTranslationBatches.set(provider, queue);
    if (queue.length >= 15) {
      const timer = translationBatchTimers.get(provider);
      if (timer !== undefined) clearTimeout(timer);
      translationBatchTimers.delete(provider);
      void flushTranslationBatch(provider);
    } else {
      scheduleTranslationBatch(provider);
    }
  });
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    void (async () => {
      try {
        switch (message.type) {
          case "GET_SETTINGS":
            sendResponse({ ok: true, data: await getSettings() });
            break;
          case "UPDATE_SETTINGS":
            sendResponse({ ok: true, data: await updateSettings(message.settings) });
            break;
          case "TRANSLATE": {
            sendResponse({ ok: true, data: await enqueueTranslation(message.text, message.provider) });
            break;
          }
          case "OPEN_ANALYSIS": {
            const sentence = message.sentence.trim();
            if (!sentence) throw new Error("当前没有可解析的句子");
            const tabId = sender.tab?.id;
            if (tabId === undefined) throw new Error("无法确定当前视频标签页");
            const query = { sentence, requestId: crypto.randomUUID(), createdAt: Date.now() };
            const openSidePanel = chrome.sidePanel.open({ tabId });
            const publishQuery = chrome.storage.local.set({ [ANALYSIS_QUERY_KEY]: query });
            await Promise.all([openSidePanel, publishQuery]);
            sendResponse({ ok: true, data: null });
            break;
          }
          case "OPEN_DICTIONARY": {
            const word = normalizeDictionaryWord(message.word);
            if (!word) throw new Error("无法识别要查询的单词");
            if (message.offline) {
              const tabId = sender.tab?.id;
              if (tabId === undefined) throw new Error("无法确定当前视频标签页");
              const query = { word, requestId: crypto.randomUUID(), createdAt: Date.now() };
              const openSidePanel = chrome.sidePanel.open({ tabId });
              const publishQuery = chrome.storage.local.set({ [DICTIONARY_QUERY_KEY]: query });
              await Promise.all([openSidePanel, publishQuery]);
              sendResponse({ ok: true, data: null });
              break;
            }
            await chrome.tabs.create({
              url: `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`
            });
            sendResponse({ ok: true, data: null });
            break;
          }
        }
      } catch (error) {
        sendResponse({ ok: false, error: errorMessage(error) });
      }
    })();
    return true;
  }
);
