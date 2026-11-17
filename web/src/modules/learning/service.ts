import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { learningRecord } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';
import { learningInput, type LearningInput } from '@/lib/learning';

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
  // Unique user + client key makes a retried save idempotent, including concurrent requests.
  const query = db()
    .insert(learningRecord)
    .values({
      ...parsed,
      id,
      userId,
      clientRecordId,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    });
  if (typeof query.onConflictDoNothing === 'function') {
    await query.onConflictDoNothing({
      target: [learningRecord.userId, learningRecord.clientRecordId],
    });
  } else {
    await query.onDuplicateKeyUpdate({
      set: { id: sql`${learningRecord.id}` },
    });
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
