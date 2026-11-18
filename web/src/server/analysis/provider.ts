import { ANALYSIS_PROMPT } from './prompt';

export async function generateAnalysis(sentence: string, config: Record<string, string>, signal?: AbortSignal, onDelta?: (text: string) => void): Promise<string> {
  const base = new URL(config.openai_base_url || 'https://api.openai.com/v1');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('Invalid AI endpoint');
  if (!config.openai_api_key || !config.openai_model) throw new Error('AI_NOT_CONFIGURED');
  const upstreamSignal = AbortSignal.any([AbortSignal.timeout(55000), ...(signal ? [signal] : [])]);
  const response = await fetch(`${base.href.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', redirect: 'error', signal: upstreamSignal,
    headers: { Authorization: `Bearer ${config.openai_api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.openai_model, stream: true, temperature: 0.2, max_tokens: 4096, messages: [{ role: 'system', content: ANALYSIS_PROMPT }, { role: 'user', content: sentence }] }),
  });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('AI provider unavailable'); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  let buffer = '', result = '', finish: string | undefined, size = 0, ended = false;
  const append = (text: unknown) => {
    if (text === undefined || text === null) return;
    if (typeof text !== 'string' || result.length + text.length > 50000) throw new Error('AI response too large');
    result += text;
    if (text) onDelta?.(text);
  };
  const event = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || ended) return;
    if (data.trim() === '[DONE]') { ended = true; return; }
    const payload = JSON.parse(data);
    if (payload.error) throw new Error('AI provider stream failed');
    const choice = payload.choices?.[0];
    append(choice?.delta?.content);
    if (choice?.finish_reason) finish = choice.finish_reason;
  };
  const abort = () => { void reader.cancel().catch(() => undefined); };
  upstreamSignal.addEventListener('abort', abort, { once: true });
  try {
    upstreamSignal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      upstreamSignal.throwIfAborted();
      size += value?.byteLength ?? 0;
      if (size > 1048576) throw new Error('AI response too large');
      buffer += decoder.decode(value, { stream: !done });
      if (streaming) {
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          event(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (ended) break;
      }
      if (done) { if (streaming && buffer.trim()) event(buffer); break; }
    }
    // Some compatible providers ignore stream:true and return a complete JSON response.
    if (!streaming) {
      const choice = JSON.parse(buffer).choices?.[0];
      finish = choice?.finish_reason;
      append(choice?.message?.content);
    }
    if (finish !== 'stop' || !result.trim()) throw new Error('AI response incomplete');
    return result;
  } finally {
    upstreamSignal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
  }
}
