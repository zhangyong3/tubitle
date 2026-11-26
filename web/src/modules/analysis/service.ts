import { userQuotaTimeZone } from '@/lib/user-quota-timezone';
import { quotaDayWindow } from '@/lib/quota-timezone';
import { planFor } from '@/lib/learning-plan';
import { createHash } from 'node:crypto';
import { and, count, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/core/db';
import { analysisUsage } from '@/config/db/schema';
import { ANALYSIS_DAILY_LIMITS } from '@/config/learning-plans';
import { getUuid } from '@/lib/hash';

export class AnalysisError extends Error {
  constructor(public code: string, message: string, public status = 409, public detail?: unknown) { super(message); }
}
export { planFor } from '@/lib/learning-plan';
async function maintain(userId: string, now: Date, day: string) {
  await db().update(analysisUsage).set({ status: 'failed', slot: null, result: null, updatedAt: now }).where(and(eq(analysisUsage.userId, userId), eq(analysisUsage.status, 'pending'), lt(analysisUsage.createdAt, new Date(now.getTime() - 180000))));
  // Keep only the current day's result cache; accounting identifiers contain no sentence text.
  await db().update(analysisUsage).set({ result: null }).where(and(eq(analysisUsage.userId, userId), lt(analysisUsage.day, day), isNotNull(analysisUsage.result)));
}
export async function quota(userId: string, now = new Date()) {
  const window = quotaDayWindow(now, await userQuotaTimeZone(userId));
  await maintain(userId, now, window.day);
  const plan = await planFor(userId, now);
  const [row] = await db().select({ used: count() }).from(analysisUsage).where(and(eq(analysisUsage.userId, userId), eq(analysisUsage.day, window.day), isNotNull(analysisUsage.slot)));
  const limit = ANALYSIS_DAILY_LIMITS[plan];
  return { plan, limit, used: Number(row.used), remaining: Math.max(0, limit - Number(row.used)), resetsAt: window.end.toISOString(), day: window.day, timeZone: window.timeZone };
}
export async function reserve(userId: string, requestId: string, sentence: string, now = new Date()) {
  const currentQuota = await quota(userId, now);
  const day = currentQuota.day;
  const sentenceHash = createHash('sha256').update(sentence).digest('hex');
  const existing = async () => {
    const [row] = await db().select().from(analysisUsage).where(and(eq(analysisUsage.userId, userId), eq(analysisUsage.requestId, requestId))).limit(1);
    if (!row) return null;
    if (row.sentenceHash !== sentenceHash || row.day !== day) throw new AnalysisError('REQUEST_MISMATCH', '请求已失效，请重新发起解析');
    if (row.status === 'completed' && row.result) return { id: row.id, result: row.result };
    throw new AnalysisError(row.status === 'pending' ? 'ANALYSIS_IN_PROGRESS' : 'REQUEST_FAILED', row.status === 'pending' ? '解析正在进行，请稍候' : '上次解析未完成，请重新发起解析');
  };
  const prior = await existing();
  if (prior) return prior;
  if (currentQuota.used >= currentQuota.limit) throw new AnalysisError('QUOTA_EXHAUSTED', currentQuota.plan === 'free' ? '今日免费解析额度已用完，请升级 Pro 套餐' : '今日 Pro 解析额度已用完，请明日再试', 403, currentQuota);
  const occupied = await db().select({ slot: analysisUsage.slot }).from(analysisUsage).where(and(eq(analysisUsage.userId, userId), eq(analysisUsage.day, day), isNotNull(analysisUsage.slot)));
  const used = new Set(occupied.map((row: { slot: number }) => row.slot));
  for (let slot = 0; slot < currentQuota.limit; slot++) {
    if (used.has(slot)) continue;
    const id = getUuid();
    const query = db().insert(analysisUsage).values({ id, userId, requestId, sentenceHash, day, slot, status: 'pending', createdAt: now, updatedAt: now });
    if (typeof query.onConflictDoNothing === 'function') await query.onConflictDoNothing();
    else await query.onDuplicateKeyUpdate({ set: { id: sql`${analysisUsage.id}` } });
    const [claimed] = await db().select().from(analysisUsage).where(and(eq(analysisUsage.userId, userId), eq(analysisUsage.requestId, requestId))).limit(1);
    if (claimed?.id === id) return { id, result: null };
    const retry = await existing();
    if (retry) return retry;
  }
  const detail = await quota(userId, now);
  throw new AnalysisError('QUOTA_EXHAUSTED', detail.plan === 'free' ? '今日免费解析额度已用完，请升级 Pro 套餐' : '今日 Pro 解析额度已用完，请明日再试', 403, detail);
}
export async function complete(userId: string, id: string, result: string) {
  await db().update(analysisUsage).set({ status: 'completed', result, updatedAt: new Date() }).where(and(eq(analysisUsage.id, id), eq(analysisUsage.userId, userId), eq(analysisUsage.status, 'pending')));
}
export async function refund(userId: string, id: string) {
  await db().update(analysisUsage).set({ status: 'failed', slot: null, result: null, updatedAt: new Date() }).where(and(eq(analysisUsage.id, id), eq(analysisUsage.userId, userId), eq(analysisUsage.status, 'pending')));
}
