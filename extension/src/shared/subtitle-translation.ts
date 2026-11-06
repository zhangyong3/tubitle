import type { ExtensionMessage, MessageResponse } from "./types";

export const SUBTITLE_TRANSLATION_PORT = "subtitle-translation";
export type SubtitleTranslationRequest = Extract<ExtensionMessage, { type: "TRANSLATE" }>;

export async function requestSubtitleTranslation(message: SubtitleTranslationRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: SUBTITLE_TRANSLATION_PORT });
    let settled = false;
    function finish(response: MessageResponse<string>) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      port.disconnect();
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    }
    function abort() {
      if (settled) return;
      settled = true;
      port.disconnect();
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(new Error(chrome.runtime.lastError?.message ?? "字幕翻译连接已断开"));
    });
    port.onMessage.addListener(finish);
    try {
      port.postMessage(message);
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : "无法请求字幕翻译" });
    }
  });
}
