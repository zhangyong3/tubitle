import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authorizeExtension } from '@/server/learning/extension-auth';
import * as analysis from '@/modules/analysis/service';
import { getAllConfigs } from '@/modules/config/service';
import { generateAnalysis } from '@/server/analysis/provider';
import { readLearningBody } from '@/server/learning/api';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respJson } from '@/lib/resp';

const input = z.object({ sentence: z.string().trim().min(1).max(2000), requestId: z.string().uuid() }).strict();
// Non-literal import also permits the Node deployment and isolated API tests.
const CF_WORKERS_MODULE = 'cloudflare:workers';
export async function handleExtensionAnalysis(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  const limited = enforceMinIntervalRateLimit(request, { intervalMs: 100, keyPrefix: 'analysis-ip' });
  if (limited) return limited;
  let reservation: { id: string; result: string | null } | undefined;
  let userId: string | undefined;
  try {
    const access = await authorizeExtension(request);
    if (access.response) return access.response;
    userId = access.userId;
    const userLimited = enforceMinIntervalRateLimit(request, { intervalMs: 200, keyPrefix: 'analysis-user', extraKey: userId });
    if (userLimited) return userLimited;
    if (request.method === 'GET') return respData(await analysis.quota(access.userId), { headers });
    const parsed = input.safeParse(await readLearningBody(request, 16384));
    if (!parsed.success) return respJson(-1, '解析请求格式无效', undefined, { status: 400, headers });
    reservation = await analysis.reserve(access.userId, parsed.data.requestId, parsed.data.sentence);
    const owner = userId;
    const claimed = reservation;
    const config = claimed.result ? {} : await getAllConfigs();
    const workerRuntime = await import(/* @vite-ignore */ CF_WORKERS_MODULE).catch(() => undefined);
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const encoder = new TextEncoder();
    let cancelled = false;
    let settled!: () => void;
    const finished = new Promise<void>(resolve => { settled = resolve; });
    const body = new ReadableStream<Uint8Array>({
      async start(stream) {
        const send = (payload: unknown) => {
          if (!cancelled) stream.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          signal.throwIfAborted();
          const delta = (content: string) => send({ choices: [{ delta: { content } }] });
          const result = claimed.result ?? await generateAnalysis(parsed.data.sentence, config, signal, delta);
          signal.throwIfAborted();
          if (claimed.result) delta(result);
          else await analysis.complete(owner, claimed.id, result);
          send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
          if (!cancelled) stream.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {
          if (!claimed.result) await analysis.refund(owner, claimed.id);
          send({ error: { message: 'AI 解析未完整完成，本次未扣除额度，请稍后重试' } });
        } finally {
          try { if (!cancelled) stream.close(); }
          finally { settled(); }
        }
      },
      cancel() { cancelled = true; controller.abort(); },
    });
    // Give quota cleanup time to finish even after the client disconnects.
    workerRuntime?.waitUntil(finished);
    return new Response(body, { headers: {
      ...headers, 'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'private, no-store, no-transform', 'x-accel-buffering': 'no',
    } });
  } catch (error) {
    if (reservation && !reservation.result && userId) await analysis.refund(userId, reservation.id);
    if (error instanceof analysis.AnalysisError) return respJson(-1, error.message, { reason: error.code, quota: error.detail }, { status: error.status, headers });
    const invalid = error instanceof SyntaxError || (error instanceof Error && ['Expected JSON', 'Missing body', 'Body too large'].includes(error.message));
    return respJson(-1, invalid ? '解析请求格式无效' : 'AI 解析暂不可用，本次未扣除额度，请稍后重试', undefined, { status: invalid ? 400 : 503, headers });
  }
}
export const Route = createFileRoute('/api/extension/analysis')({ server: { handlers: {
  GET: ({ request }) => handleExtensionAnalysis(request), POST: ({ request }) => handleExtensionAnalysis(request),
} } });
