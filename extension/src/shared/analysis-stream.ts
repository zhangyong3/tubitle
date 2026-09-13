import { authenticatedFetch, readJsonResponse } from "./api-client";

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
  const response = await authenticatedFetch("/api/analyze/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sentence }),
    signal
  });
  if (!response.ok) {
    const payload = await readJsonResponse<{ error?: string; message?: string }>(response)
      .catch((): { error?: string; message?: string } => ({}));
    throw new Error(payload.message || payload.error || `服务端请求失败 (${response.status})`);
  }
  if (!response.body) throw new Error("浏览器无法读取流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let payload: { delta?: string; error?: string; done?: boolean };
        try {
          payload = JSON.parse(data) as typeof payload;
        } catch {
          throw new Error("句子解析流返回了不完整的数据，请重试");
        }
        if (payload.error) throw new Error(payload.error);
        if (payload.delta) onDelta(payload.delta);
        if (payload.done) return;
      }
    }
    if (done) break;
  }
}
