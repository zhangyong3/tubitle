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
    const result = reservation.result ?? await generateAnalysis(parsed.data.sentence, await getAllConfigs(), request.signal);
    if (!reservation.result) await analysis.complete(access.userId, reservation.id, result);
    return respData({ choices: [{ message: { content: result } }] }, { headers });
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
