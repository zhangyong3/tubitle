export const ANALYSIS_QUERY_KEY = "sentenceAnalysisQuery";

export interface AnalysisQuery {
  sentence: string;
  requestId: string;
  createdAt: number;
  videoId?: string;
  videoTitle?: string;
  startMs?: number;
}

export async function streamSentenceAnalysis(
  sentence: string,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
  requestId: string = crypto.randomUUID()
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "analysis-stream" });
    let settled = false;
    const abort = () => { settled = true; port.disconnect(); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    port.onMessage.addListener((payload: { delta?: string; error?: string; done?: boolean; reason?: string; actionUrl?: string }) => {
      if (settled || signal.aborted) return;
      if (payload.delta) onDelta(payload.delta);
      if (payload.error) { settled = true; signal.removeEventListener("abort", abort); reject(Object.assign(new Error(payload.error), { reason: payload.reason, actionUrl: payload.actionUrl })); }
      if (payload.done) { settled = true; signal.removeEventListener("abort", abort); resolve(); }
    });
    port.onDisconnect.addListener(() => {
      signal.removeEventListener("abort", abort);
      if (!settled && !signal.aborted) { settled = true; reject(new Error("大模型连接意外中断")); }
    });
    port.postMessage({ sentence, requestId });
  });
}
