import { userQuotaTimeZone } from '@/lib/user-quota-timezone';
import { quotaDayWindow } from '@/lib/quota-timezone';
import { atomic, AtomicGuardError, guard } from '@/core/db/atomic';
import { LEARNING_FREE_LIMITS } from '@/config/learning-plans';
import { planFor } from '@/lib/learning-plan';
import { readDictionarySnapshots } from '@/lib/dictionary-snapshots';
import { and, count, desc, eq, gte, lt, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { learningRecord, user } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';
import { learningInput, type LearningInput } from '@/lib/learning';

export class LearningQuotaError extends Error {
  constructor(public reason: 'LEARNING_DAILY_LIMIT' | 'LEARNING_TOTAL_LIMIT') {
    super(reason === 'LEARNING_DAILY_LIMIT'
      ? '免费版每天可新增 5 条学习库记录，请明日再试或升级 Pro'
      : '免费版学习库最多保留 100 条记录，请删除部分记录或升级 Pro');
  }
}
function owned(userId: string) {
  return and(
    eq(learningRecord.userId, userId),
    isNull(learningRecord.deletedAt)
  );
}
const publicColumns = {
  id: learningRecord.id,
  clientRecordId: learningRecord.clientRecordId,
  kind: learningRecord.kind,
  text: learningRecord.text,
  context: learningRecord.context,
  translation: learningRecord.translation,
  note: learningRecord.note,
  analysis: learningRecord.analysis,
  videoId: learningRecord.videoId,
  videoTitle: learningRecord.videoTitle,
  startSeconds: learningRecord.startSeconds,
  endSeconds: learningRecord.endSeconds,
  status: learningRecord.status,
  createdAt: learningRecord.createdAt,
  updatedAt: learningRecord.updatedAt,
};
export async function create(
  userId: string,
  input: LearningInput,
  acknowledgeDeleted = false
) {
  const parsed = learningInput.parse(input);
  const clientRecordId = parsed.clientRecordId || getUuid();
  const id = getUuid();
  const now = new Date();
  const free = await planFor(userId, now) === 'free';
  const { start, end } = quotaDayWindow(now, await userQuotaTimeZone(userId));
  try {
    await atomic(q => {
      const query = q.insert(learningRecord).values({ ...parsed, id, userId, clientRecordId, status: 'new', createdAt: now, updatedAt: now });
      const insert = typeof query.onConflictDoNothing === 'function'
        ? query.onConflictDoNothing({ target: [learningRecord.userId, learningRecord.clientRecordId] })
        : query.onDuplicateKeyUpdate({ set: { id: sql`${learningRecord.id}` } });
      return [
        // Serialize account-level limits on transactional databases; batch databases serialize writes.
        free && guard({ table: user, column: 'id', where: eq(user.id, userId), require: sql`1 = 1`, message: 'learning account lock' }),
        insert,
        // These guards only match a newly inserted row. Idempotent retries and
        // dictionary enrichment remain available even when a limit is reached.
        free && guard({ table: learningRecord, column: 'id', where: eq(learningRecord.id, id),
          require: sql`(select count(*) from ${learningRecord} where ${owned(userId)}) <= ${LEARNING_FREE_LIMITS.total}`,
          message: 'LEARNING_TOTAL_LIMIT' }),
        free && guard({ table: learningRecord, column: 'id', where: eq(learningRecord.id, id),
          require: sql`(select count(*) from ${learningRecord} where ${and(eq(learningRecord.userId, userId), gte(learningRecord.createdAt, start), lt(learningRecord.createdAt, end))}) <= ${LEARNING_FREE_LIMITS.daily}`,
          message: 'LEARNING_DAILY_LIMIT' }),
      ];
    });
  } catch (error) {
    if (error instanceof AtomicGuardError && ['LEARNING_DAILY_LIMIT', 'LEARNING_TOTAL_LIMIT'].includes(error.message)) {
      // Both postconditions protect the same column in batch mode. Determine
      // which limit is exhausted after the rejected insert has rolled back.
      const [total] = await db().select({ value: count() }).from(learningRecord).where(owned(userId));
      throw new LearningQuotaError(Number(total.value) >= LEARNING_FREE_LIMITS.total ? 'LEARNING_TOTAL_LIMIT' : 'LEARNING_DAILY_LIMIT');
    }
    throw error;
  }
  // Dictionary providers finish after the initial word save. Enrich that same
  // owned record without replacing notes, status, timestamps or deleted records.
  if (parsed.kind === 'word' && readDictionarySnapshots(parsed.analysis).length) {
    await db().update(learningRecord).set({ analysis: parsed.analysis, updatedAt: now }).where(and(
      owned(userId), eq(learningRecord.clientRecordId, clientRecordId),
      eq(learningRecord.kind, 'word'), eq(learningRecord.text, parsed.text)
    ));
  }
  const [row] = await db()
    .select(publicColumns)
    .from(learningRecord)
    .where(
      and(owned(userId), eq(learningRecord.clientRecordId, clientRecordId))
    )
    .limit(1);
  if (!row && acknowledgeDeleted) return null;
  if (!row) throw new Error('This save key was deleted; use a new save key.');
  return row;
}
export async function list(
  userId: string,
  options: {
    search?: string;
    kind?: string;
    status?: string;
    page?: number;
  } = {}
) {
  const search = options.search?.trim();
  // Escape LIKE metacharacters so search is a literal substring, not a wildcard query.
  const escaped = search?.replace(/[!%_]/g, '!$&');
  const filters = and(
    owned(userId),
    escaped
      ? or(
          sql`${learningRecord.text} like ${`%${escaped}%`} escape '!'`,
          sql`${learningRecord.context} like ${`%${escaped}%`} escape '!'`
        )
      : undefined,
    options.kind ? eq(learningRecord.kind, options.kind) : undefined,
    options.status ? eq(learningRecord.status, options.status) : undefined
  );
  const [items, totals, summaries] = await Promise.all([
    db()
      .select(publicColumns)
      .from(learningRecord)
      .where(filters)
      .orderBy(desc(learningRecord.createdAt), desc(learningRecord.id))
      .limit(20)
      .offset(((options.page || 1) - 1) * 20),
    db().select({ total: count() }).from(learningRecord).where(filters),
    db()
      .select({
        total: count(),
        words: sql<number>`coalesce(sum(case when ${learningRecord.kind} = 'word' then 1 else 0 end), 0)`,
        sentences: sql<number>`coalesce(sum(case when ${learningRecord.kind} = 'sentence' then 1 else 0 end), 0)`,
        mastered: sql<number>`coalesce(sum(case when ${learningRecord.status} = 'mastered' then 1 else 0 end), 0)`,
        videos: sql<number>`count(distinct ${learningRecord.videoId})`,
      })
      .from(learningRecord)
      .where(owned(userId)),
  ]);
  return {
    items,
    total: Number(totals[0].total),
    summary: Object.fromEntries(
      Object.entries(summaries[0]).map(([k, v]) => [k, Number(v)])
    ),
  };
}
export async function updateStatus(
  userId: string,
  id: string,
  status: 'new' | 'learning' | 'mastered'
) {
  await db()
    .update(learningRecord)
    .set({ status, updatedAt: new Date() })
    .where(and(owned(userId), eq(learningRecord.id, id)));
  const [row] = await db()
    .select(publicColumns)
    .from(learningRecord)
    .where(and(owned(userId), eq(learningRecord.id, id)))
    .limit(1);
  return row ?? null;
}
export async function remove(userId: string, id: string) {
  // Retain a tombstone for retry protection, while removing the saved content itself.
  await db()
    .update(learningRecord)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      text: '',
      context: '',
      translation: '',
      note: '',
      analysis: '',
      videoId: '',
      videoTitle: '',
      startSeconds: 0,
      endSeconds: null,
    })
    .where(and(owned(userId), eq(learningRecord.id, id)));
}
export async function exportRecords(userId: string) {
  return db()
    .select(publicColumns)
    .from(learningRecord)
    .where(owned(userId))
    .orderBy(desc(learningRecord.createdAt));
}
