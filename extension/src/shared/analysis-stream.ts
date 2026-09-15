export const ANALYSIS_QUERY_KEY = "sentenceAnalysisQuery";

export interface AnalysisQuery {
  sentence: string;
  requestId: string;
  createdAt: number;
}

export async function streamSentenceAnalysis(
  sentence: string,
  onDelta: (delta: string) => void,
  signal: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "analysis-stream" });
    let settled = false;
    const abort = () => { port.disconnect(); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    port.onMessage.addListener((payload: { delta?: string; error?: string; done?: boolean }) => {
      if (payload.delta) onDelta(payload.delta);
      if (payload.error) { settled = true; signal.removeEventListener("abort", abort); reject(new Error(payload.error)); }
      if (payload.done) { settled = true; signal.removeEventListener("abort", abort); resolve(); }
    });
    port.onDisconnect.addListener(() => {
      if (!settled && !signal.aborted) reject(new Error("大模型连接意外中断"));
    });
    port.postMessage({ sentence });
  });
}
