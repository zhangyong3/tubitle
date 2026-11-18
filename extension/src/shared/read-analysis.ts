/** Consume both streamed platform/custom responses and older JSON responses. */
export async function readAnalysisResponse(response: Response, onDelta: (text: string) => void, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error('大模型没有返回可读数据流');
  signal.throwIfAborted();
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    signal.throwIfAborted();
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new Error('大模型返回了空结果');
    onDelta(text);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', size = 0, contentSize = 0, finish: string | undefined, ended = false;
  const event = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || ended) return;
    if (data.trim() === '[DONE]') { ended = true; return; }
    const payload = JSON.parse(data);
    if (payload.error) throw new Error(typeof payload.error.message === 'string' ? payload.error.message : '大模型连接意外中断');
    const choice = payload.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta != null && typeof delta !== 'string') throw new Error('大模型返回的数据无效');
    if (delta) {
      contentSize += delta.length;
      if (contentSize > 50000) throw new Error('大模型返回的内容过长');
      onDelta(delta);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  };
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      size += value?.byteLength ?? 0;
      if (size > 1048576) throw new Error('大模型返回的内容过长');
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (done) { if (buffer.trim()) event(buffer); break; }
    }
    if (finish !== 'stop' || !contentSize) throw new Error('AI 解析未完整完成，请稍后重试');
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
  }
}
