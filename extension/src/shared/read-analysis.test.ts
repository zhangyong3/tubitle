import { expect, it } from 'vitest';
import { readAnalysisResponse } from './read-analysis';
const encoder = new TextEncoder();
const frame = (content: string, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\r\n\r\n`;
const response = (chunks: string[]) => new Response(new ReadableStream({ start(controller) {
  for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close();
} }), { headers: { 'content-type': 'text/event-stream' } });

it('delivers the first text before the upstream closes, including fragmented UTF-8 and CRLF', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const res = new Response(new ReadableStream({ start(value) { controller = value; } }), {headers:{'content-type':'text/event-stream'}});
  const received: string[] = [];
  let first!: () => void;
  const arrived = new Promise<void>(resolve => first = resolve);
  let completed = false;
  const pending = readAnalysisResponse(res, text => { received.push(text); first(); }, new AbortController().signal).then(() => { completed = true; });
  const bytes = encoder.encode(frame('翻译：你好'));
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await arrived;
  expect(received).toEqual(['翻译：你好']);
  expect(completed).toBe(false);
  controller.enqueue(encoder.encode(frame('。', 'stop') + 'data: [DONE]\n\n'));
  controller.close();
  await pending;
  expect(received.join('')).toBe('翻译：你好。');
});
it('retains partial deltas but rejects truncated, malformed and error streams', async () => {
  for (const tail of ['', frame('', 'length'), 'data: {bad}\n\n', 'data: {"error":{"message":"本次未扣除额度"}}\n\n']) {
    let text = '';
    await expect(readAnalysisResponse(response([frame('partial'), tail]), delta => text += delta, new AbortController().signal)).rejects.toThrow();
    expect(text).toBe('partial');
  }
});
it('cancels the underlying stream promptly on abort', async () => {
  let cancelled = false;
  const res = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {headers:{'content-type':'text/event-stream'}});
  const abort = new AbortController();
  const pending = readAnalysisResponse(res, () => {}, abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name:'AbortError' });
  expect(cancelled).toBe(true);
});
