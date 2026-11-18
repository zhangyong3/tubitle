import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { eq, lt, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic, AtomicGuardError, guard } from '@/core/db/atomic';
import { TRANSLATION_DEFAULTS } from '@/core/translation/config';
import { envConfigs } from '@/config';
import { translationQuota } from '@/config/db/schema';
import { analysisDay } from '@/config/learning-plans';
import { planFor } from '@/modules/analysis/service';

export const GUEST_LOGIN_MESSAGE = '今日匿名双语翻译额度已用完，请登录Tubitle开启更高额度';
export const FREE_QUOTA_MESSAGE =
  '今日免费双语翻译额度已耗尽，请升级为Pro开启更高额度';
export class SubtitleQuotaError extends Error {
  constructor(
    public guest: boolean,
    public pro = false
  ) {
    super(
      guest
        ? GUEST_LOGIN_MESSAGE
        : pro
          ? 'Pro实时双语额度已耗尽，请明日再试'
          : FREE_QUOTA_MESSAGE
    );
  }
}
// At most one small lease per identity per isolate. Reservations survive
// restarts in SQL; losing a lease can reduce availability, never grant extra.
const leases = new Map<string, { left: number; day: string }>();
const locks = new Map<string, Promise<unknown>>();
const plans = new Map<string, { plan: 'free' | 'pro'; until: number }>();
let cleanupDay = '';
let leasesDay = '';
export async function subtitlePlan(
  userId: string
): Promise<'guest' | 'free' | 'pro'> {
  if (!userId) return 'guest';
  const cached = plans.get(userId);
  if (cached && cached.until > Date.now()) return cached.plan;
  const plan = await planFor(userId);
  if (plans.size >= 10000) plans.delete(plans.keys().next().value!);
  plans.set(userId, { plan, until: Date.now() + 60000 });
  return plan;
}
export function subtitleIdentity(
  request: Request,
  userId: string,
  day = analysisDay()
): string {
  // Deployment proxy must overwrite these headers and block direct origin access.
  const raw =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '';
  let ip = raw;
  if (isIP(raw) === 6) ip = new URL(`http://[${raw}]/`).hostname;
  if (!userId && !isIP(raw)) throw new SubtitleQuotaError(true);
  if (!envConfigs.auth_secret) throw new Error('Missing quota signing secret');
  return createHmac('sha256', envConfigs.auth_secret)
    .update(`${day}\0${userId ? `user:${userId}` : `ip:${ip}`}`)
    .digest('hex');
}
export async function consumeSubtitleQuota(
  id: string,
  plan: 'guest' | 'free' | 'pro',
  config: Record<string, string>,
  now = new Date()
): Promise<void> {
  const day = analysisDay(now);
  const limit = Number(
    config[`translation_${plan}_daily_limit`] ??
      TRANSLATION_DEFAULTS[`translation_${plan}_daily_limit`]
  );
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new SubtitleQuotaError(plan === 'guest', plan === 'pro');
  const key = `${id}:${limit}`;
  const previous = locks.get(key) ?? Promise.resolve();
  const work = previous
    .catch(() => undefined)
    .then(async () => {
      if (leasesDay !== day) {
        leases.clear();
        leasesDay = day;
      }
      const local = leases.get(key);
      if (local?.day === day) {
        if (local.left < 0)
          throw new SubtitleQuotaError(plan === 'guest', plan === 'pro');
        if (local.left > 0) {
          local.left--;
          return;
        }
      }
      if (cleanupDay !== day) {
        cleanupDay = day;
        try {
          await db()
            .delete(translationQuota)
            .where(lt(translationQuota.day, day));
        } catch (error) {
          cleanupDay = '';
          throw error;
        }
      }
      const reserveLease = (grant: number) => {
        if (leases.size >= 10000) leases.delete(leases.keys().next().value!);
        leases.set(key, { left: grant - 1, day });
      };
      // SQLite/D1/Postgres: a single conditional UPSERT per five sentences.
      // Try one at the boundary so non-multiple limits are usable in full.
      if (envConfigs.database_provider !== 'mysql') {
        for (const grant of [...new Set([Math.min(5, limit), 1])]) {
          const rows = await db()
            .insert(translationQuota)
            .values({ id, day, used: grant })
            .onConflictDoUpdate({
              target: translationQuota.id,
              set: { used: sql`${translationQuota.used} + ${grant}` },
              setWhere: sql`${translationQuota.used} + ${grant} <= ${limit}`,
            })
            .returning({ used: translationQuota.used });
          if (rows.length) {
            reserveLease(grant);
            return;
          }
        }
        reserveLease(0); // Cache exhaustion for this day and configured limit.
        throw new SubtitleQuotaError(plan === 'guest', plan === 'pro');
      }
      const insert = db().insert(translationQuota).values({ id, day, used: 0 });
      await insert.onDuplicateKeyUpdate({
        set: { id: sql`${translationQuota.id}` },
      });
      for (let attempt = 0; attempt < 5; attempt++) {
        const [row] = await db()
          .select()
          .from(translationQuota)
          .where(eq(translationQuota.id, id));
        const grant = Math.min(5, limit - Number(row.used));
        if (grant <= 0) {
          reserveLease(0);
          throw new SubtitleQuotaError(plan === 'guest', plan === 'pro');
        }
        try {
          await atomic((q) => [
            q
              .update(translationQuota)
              .set({ used: sql`${translationQuota.used} + ${grant}` })
              .where(eq(translationQuota.id, id)),
            guard({
              table: translationQuota,
              column: 'used',
              where: eq(translationQuota.id, id),
              require: sql`${translationQuota.used} <= ${limit}`,
              message: 'subtitle quota contention',
            }),
          ]);
          reserveLease(grant);
          return;
        } catch (error) {
          if (!(error instanceof AtomicGuardError)) throw error;
        }
      }
      throw new Error('Subtitle quota busy');
    });
  locks.set(key, work);
  try {
    await work;
  } finally {
    if (locks.get(key) === work) locks.delete(key);
  }
}
