import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql, sum } from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic, guard } from '@/core/db/atomic';
import {
  learningActivity,
  memberUsageDay,
  podcastEpisode,
  user,
} from '@/config/db/schema';
import { learningActivityInput } from '@/lib/learning';
import { oldestUsageDay, usageDay, validActivityDay } from '@/lib/podcast';

const ignore = (query: any) =>
  typeof query.onConflictDoNothing === 'function'
    ? query.onConflictDoNothing()
    : query.onDuplicateKeyUpdate({ set: { id: sql`${memberUsageDay.id}` } });
export async function recordTranslation(userId: string, now = new Date()) {
  if (!userId) return;
  const day = usageDay(now),
    id = createHash('sha256').update(`${userId}:${day}`).digest('hex');
  const query = db()
    .insert(memberUsageDay)
    .values({
      id,
      userId,
      day,
      translations: 1,
      playbackMs: 0,
      updatedAt: now,
    });
  const set = {
    translations: sql`${memberUsageDay.translations}+1`,
    updatedAt: now,
  };
  if (typeof query.onConflictDoUpdate === 'function')
    await query.onConflictDoUpdate({ target: memberUsageDay.id, set });
  else await query.onDuplicateKeyUpdate({ set });
}
export async function savePlayback(
  userId: string,
  input: {
    clientId: string;
    days: { day: string; sentences: number; durationMs: number }[];
  },
  now = new Date()
) {
  const parsed = learningActivityInput.parse({ ...input, type: 'activity' });
  for (const day of parsed.days) {
    if (!validActivityDay(day.day, now)) continue;
    if (day.durationMs > 86400000) throw new Error('ACTIVITY_DURATION_LIMIT');
    const id = createHash('sha256')
      .update(`${userId}\0${input.clientId}\0${day.day}`)
      .digest('hex');
    const dailyId = createHash('sha256')
      .update(`${userId}:${day.day}`)
      .digest('hex');
    await atomic((q) => {
      const checkpoint = q
        .insert(learningActivity)
        .values({
          id,
          userId,
          clientId: input.clientId,
          day: day.day,
          sentences: 0,
          durationMs: 0,
          updatedAt: now,
        });
      const initial =
        typeof checkpoint.onConflictDoNothing === 'function'
          ? checkpoint.onConflictDoNothing()
          : checkpoint.onDuplicateKeyUpdate({
              set: { id: sql`${learningActivity.id}` },
            });
      const daily = q
        .insert(memberUsageDay)
        .values({ id: dailyId, userId, day: day.day, updatedAt: now });
      const delta = sql`(select case when ${learningActivity.durationMs} < ${day.durationMs} then ${day.durationMs} - ${learningActivity.durationMs} else 0 end from ${learningActivity} where ${learningActivity.id} = ${id})`;
      return [
        guard({
          table: user,
          column: 'id',
          where: eq(user.id, userId),
          require: sql`1 = 1`,
          message: 'usage account lock',
        }),
        initial,
        guard({
          table: learningActivity,
          column: 'id',
          where: eq(learningActivity.id, id),
          require: sql`(select count(*) from ${learningActivity} where ${learningActivity.userId} = ${userId} and ${learningActivity.day} = ${day.day}) <= 10`,
          message: 'ACTIVITY_DEVICE_LIMIT',
        }),
        ignore(daily),
        q
          .update(memberUsageDay)
          .set({
            playbackMs: sql`${memberUsageDay.playbackMs} + ${delta}`,
            updatedAt: now,
          })
          .where(eq(memberUsageDay.id, dailyId)),
        q
          .update(learningActivity)
          .set({
            durationMs: sql`case when ${learningActivity.durationMs} < ${day.durationMs} then ${day.durationMs} else ${learningActivity.durationMs} end`,
            sentences: sql`case when ${learningActivity.sentences} < ${day.sentences} then ${day.sentences} else ${learningActivity.sentences} end`,
            updatedAt: now,
          })
          .where(eq(learningActivity.id, id)),
      ];
    });
  }
}
export async function usageFor(userId: string) {
  const days = await db()
    .select()
    .from(memberUsageDay)
    .where(
      and(
        eq(memberUsageDay.userId, userId),
        gte(memberUsageDay.day, oldestUsageDay())
      )
    )
    .orderBy(desc(memberUsageDay.day))
    .limit(30);
  const podcasts = await db()
    .select({
      listened: podcastEpisode.listenedMs,
      published: podcastEpisode.publishedAt,
      last: podcastEpisode.lastListenedAt,
    })
    .from(podcastEpisode)
    .where(
      and(
        eq(podcastEpisode.userId, userId),
        gte(podcastEpisode.expiresAt, new Date()),
        sql`${podcastEpisode.status} <> 'deleting'`
      )
    )
    .limit(30);
  return {
    days,
    totals: {
      translations: days.reduce((n: number, d: any) => n + d.translations, 0),
      playbackMs: days.reduce((n: number, d: any) => n + d.playbackMs, 0),
      podcasts: podcasts.filter((p: any) => p.published).length,
      listenedMs: podcasts.reduce((n: number, p: any) => n + p.listened, 0),
      lastActiveAt:
        [
          ...days.map((d: any) => d.updatedAt),
          ...podcasts.map((p: any) => p.last).filter(Boolean),
        ].sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] || null,
    },
  };
}

export async function usageTotalsFor(userIds: string[]) {
  if (!userIds.length) return new Map();
  const rows = await db()
    .select({
      userId: memberUsageDay.userId,
      translations: sum(memberUsageDay.translations),
      playbackMs: sum(memberUsageDay.playbackMs),
    })
    .from(memberUsageDay)
    .where(
      and(
        inArray(memberUsageDay.userId, userIds),
        gte(memberUsageDay.day, oldestUsageDay())
      )
    )
    .groupBy(memberUsageDay.userId);
  return new Map(
    rows.map((r: any) => [
      r.userId,
      {
        translations: Number(r.translations || 0),
        playbackMs: Number(r.playbackMs || 0),
      },
    ])
  );
}
