import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  sql,
} from 'drizzle-orm';

import { affectedRows, db } from '@/core/db';
import { atomic, guard } from '@/core/db/atomic';
import {
  podcastEpisode as episode,
  learningRecord,
  podcastPreference as pref,
  podcastSource as source,
  user,
} from '@/config/db/schema';
import { getUuid } from '@/lib/hash';
import { planFor } from '@/lib/learning-plan';
import {
  normalizePodcastLanguage,
  PODCAST_INTERVAL_MS,
  PodcastError,
  podcastLanguages,
  RETENTION_MS,
  type AudioSegment,
  type PodcastScript,
} from '@/lib/podcast';
import { sqlTime } from '@/lib/podcast-db';

export async function preference(userId: string) {
  const [existing] = await db()
    .select()
    .from(pref)
    .where(eq(pref.userId, userId));
  if (existing) return existing;
  const [account] = await db()
    .select({ language: user.podcastLanguage })
    .from(user)
    .where(eq(user.id, userId));
  const values = { userId, language: account?.language || '', enabled: 0 };
  const insert = db().insert(pref).values(values);
  if (typeof insert.onConflictDoNothing === 'function')
    await insert.onConflictDoNothing();
  else
    await insert.onDuplicateKeyUpdate({ set: { userId: sql`${pref.userId}` } });
  return (await db().select().from(pref).where(eq(pref.userId, userId)))[0];
}
export async function setPreference(
  userId: string,
  input: { language?: string; enabled?: boolean; dismissNotice?: boolean }
) {
  await preference(userId);
  const language = input.language
    ? normalizePodcastLanguage(input.language)
    : undefined;
  await atomic((q) => [
    (language || input.enabled !== undefined) &&
      q
        .update(pref)
        .set({
          ...(language ? { language } : {}),
          ...(input.enabled !== undefined
            ? { enabled: input.enabled ? 1 : 0 }
            : {}),
        })
        .where(eq(pref.userId, userId)),
    q
      .update(user)
      .set({
        ...(language ? { podcastLanguage: language } : {}),
        podcastLanguageNotice: 0,
      })
      .where(eq(user.id, userId)),
  ]);
  return preference(userId);
}
export async function selectSources(userId: string) {
  const records = await db()
    .select()
    .from(learningRecord)
    .where(
      and(
        eq(learningRecord.userId, userId),
        isNull(learningRecord.deletedAt),
        inArray(learningRecord.status, ['new', 'learning']),
        gt(learningRecord.createdAt, new Date(Date.now() - 30 * 86400000))
      )
    )
    .orderBy(desc(learningRecord.createdAt))
    .limit(500);
  const groups = new Map<string, any[]>();
  const seen = new Set<string>();
  for (const row of records) {
    if (!row.sourceLanguage) continue;
    const key = `${row.sourceLanguage}:${row.text.normalize('NFKC').toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = groups.get(row.sourceLanguage) || [];
    list.push(row);
    groups.set(row.sourceLanguage, list);
  }
  const candidates = [...groups.entries()]
    .filter(([, rows]) => rows.length >= 5)
    .map(([language, rows]) => ({
      language,
      rows,
      uncovered: rows.filter((r) => !r.lastPodcastAt),
      last: Math.max(...rows.map((r) => r.lastPodcastAt?.getTime() || 0)),
    }))
    .filter((g) => g.last === 0 || g.uncovered.length >= 3)
    .sort((a, b) => a.last - b.last || b.uncovered.length - a.uncovered.length);
  const selected = candidates[0];
  if (!selected) throw new PodcastError('NOT_ENOUGH_MATERIAL');
  const fresh = selected.uncovered.slice(0, 6);
  const old = selected.rows
    .filter((r) => r.lastPodcastAt)
    .sort((a, b) => a.lastPodcastAt - b.lastPodcastAt)
    .slice(0, 2);
  const rows = [...fresh, ...old].slice(0, 8);
  if (rows.length < 5) throw new PodcastError('NOT_ENOUGH_MATERIAL');
  return { language: selected.language, rows };
}
export async function createEpisode(userId: string, now = new Date()) {
  const p = await preference(userId);
  if (!p.language) throw new PodcastError('CONFIRM_PODCAST_LANGUAGE');
  if (p.activeEpisodeId) {
    const prior = await ownedEpisode(userId, p.activeEpisodeId, now);
    if (prior) return prior;
  }
  const plan = await planFor(userId, now);
  if (plan === 'free' && p.trialConsumedAt)
    throw new PodcastError('TRIAL_USED', 403);
  if (p.nextDueAt && p.nextDueAt > now)
    throw new PodcastError('PODCAST_NOT_DUE');
  const selected = await selectSources(userId);
  if (
    ![p.language, selected.language].every((language) =>
      podcastLanguages.some(
        (supported) =>
          supported.toLowerCase().split('-')[0] ===
          language.toLowerCase().split('-')[0]
      )
    )
  )
    throw new PodcastError('TTS_LANGUAGE_UNSUPPORTED');
  const id = getUuid();
  await atomic((q) => [
    guard({
      table: pref,
      column: 'userId',
      where: eq(pref.userId, userId),
      require: sql`${pref.activeEpisodeId} is null and (${pref.nextDueAt} is null or ${pref.nextDueAt} <= ${sqlTime(now)}) and ${pref.language} = ${p.language} ${plan === 'free' ? sql`and ${pref.trialConsumedAt} is null` : sql``}`,
      message: 'PODCAST_ALREADY_RESERVED',
    }),
    q
      .insert(episode)
      .values({
        id,
        userId,
        kind: plan === 'pro' ? 'pro' : 'trial',
        sourceLanguage: selected.language,
        translationLanguage: p.language,
        title: '',
        status: 'queued',
        createdAt: now,
        expiresAt: new Date(now.getTime() + RETENTION_MS),
      }),
    ...selected.rows.map((row) =>
      q
        .insert(source)
        .values({ id: getUuid(), episodeId: id, recordId: row.id })
    ),
    q
      .update(pref)
      .set({
        activeEpisodeId: id,
        nextDueAt: new Date(now.getTime() + PODCAST_INTERVAL_MS),
      })
      .where(eq(pref.userId, userId)),
  ]);
  return ownedEpisode(userId, id, now);
}
export async function ownedEpisode(
  userId: string,
  id: string,
  now = new Date()
) {
  const [row] = await db()
    .select()
    .from(episode)
    .where(
      and(
        eq(episode.id, id),
        eq(episode.userId, userId),
        gt(episode.expiresAt, now),
        sql`${episode.status} <> 'deleting'`
      )
    );
  return row || null;
}
export async function listEpisodes(userId: string, page = 1) {
  return db()
    .select()
    .from(episode)
    .where(
      and(
        eq(episode.userId, userId),
        gt(episode.expiresAt, new Date()),
        sql`${episode.status} <> 'deleting'`
      )
    )
    .orderBy(desc(episode.createdAt))
    .limit(10)
    .offset((page - 1) * 10);
}
export async function sourcesFor(id: string) {
  return db()
    .select({ record: learningRecord })
    .from(source)
    .innerJoin(learningRecord, eq(source.recordId, learningRecord.id))
    .where(eq(source.episodeId, id));
}
export async function invalidateForRecord(userId: string, recordId: string) {
  const links = await db()
    .select({ id: source.episodeId })
    .from(source)
    .where(eq(source.recordId, recordId));
  for (const link of links) await markDeleting(userId, link.id);
}
export async function markDeleting(userId: string, id: string) {
  await db()
    .update(episode)
    .set({
      status: 'deleting',
      script: null,
      title: '',
      leaseToken: null,
      leaseUntil: null,
    })
    .where(and(eq(episode.userId, userId), eq(episode.id, id)));
}
export async function updateProgress(
  userId: string,
  id: string,
  input: {
    client: string;
    sequence: number;
    segment: number;
    offset: number;
    deltaMs: number;
  },
  now = new Date()
) {
  const row = await ownedEpisode(userId, id, now);
  if (!row || row.status !== 'ready') throw new PodcastError('NOT_FOUND', 404);
  const manifest: AudioSegment[] = JSON.parse(row.manifest || '[]');
  if (
    !manifest[input.segment] ||
    input.offset > manifest[input.segment].durationMs + 1000
  )
    throw new PodcastError('INVALID_PROGRESS', 400);
  if (
    row.playbackClient === input.client &&
    row.playbackSequence >= input.sequence
  )
    return;
  const maxElapsed = row.lastListenedAt
    ? Math.max(0, now.getTime() - row.lastListenedAt.getTime())
    : 0;
  const delta = Math.min(input.deltaMs, 30000, maxElapsed);
  const coverage = new Set<number>(JSON.parse(row.coverage || '[]'));
  const advance = input.offset - row.progressOffset;
  if (
    row.playbackClient === input.client &&
    row.progress === input.segment &&
    delta > 0 &&
    advance > 0 &&
    advance <= delta * 2 + 1000
  ) {
    const prefix = manifest
      .slice(0, input.segment)
      .reduce((n, s) => n + s.durationMs, 0);
    for (
      let second = Math.ceil((prefix + row.progressOffset) / 1000);
      second < Math.floor((prefix + input.offset) / 1000);
      second++
    )
      if (second >= 0 && second < 360) coverage.add(second);
  }
  const complete = coverage.size >= Math.floor(row.durationMs / 1000) * 0.95;
  await db()
    .update(episode)
    .set({
      coverage: JSON.stringify([...coverage].sort((a, b) => a - b)),
      completedAt: row.completedAt || (complete ? now : null),
      progress: input.segment,
      progressOffset: input.offset,
      lastListenedAt: now,
      playbackSequence: input.sequence,
      playbackClient: input.client,
      listenedMs: sql`${episode.listenedMs}+${delta}`,
    })
    .where(
      and(
        eq(episode.id, id),
        eq(episode.userId, userId),
        eq(episode.status, 'ready'),
        gt(episode.expiresAt, now),
        sql`${episode.playbackSequence} = ${row.playbackSequence}`,
        row.lastListenedAt
          ? eq(episode.lastListenedAt, row.lastListenedAt)
          : isNull(episode.lastListenedAt)
      )
    );
}
export async function claim(id: string, now = new Date()) {
  const token = getUuid();
  const result = await db()
    .update(episode)
    .set({
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + 150000),
      status: 'working',
    })
    .where(
      and(
        eq(episode.id, id),
        inArray(episode.status, ['queued', 'working', 'retry']),
        gt(episode.expiresAt, now),
        sql`(${episode.leaseUntil} is null or ${episode.leaseUntil} < ${sqlTime(now)})`,
        sql`(${episode.retryAt} is null or ${episode.retryAt} <= ${sqlTime(now)})`
      )
    );
  if (affectedRows(result) === 0) return null;
  const [row] = await db()
    .select()
    .from(episode)
    .where(and(eq(episode.id, id), eq(episode.leaseToken, token)));
  return row || null;
}
export async function checkpoint(
  id: string,
  token: string,
  values: Record<string, unknown>
) {
  const result = await db()
    .update(episode)
    .set({ ...values, leaseToken: null, leaseUntil: null })
    .where(
      and(
        eq(episode.id, id),
        eq(episode.leaseToken, token),
        eq(episode.status, 'working'),
        gt(episode.expiresAt, new Date())
      )
    );
  if (affectedRows(result) !== 1) throw new PodcastError('LEASE_LOST');
}
export async function publish(
  row: any,
  script: PodcastScript,
  manifest: AudioSegment[],
  now = new Date()
) {
  const records = await sourcesFor(row.id);
  if (
    !records.length ||
    records.some(
      (s: any) => s.record.deletedAt || s.record.userId !== row.userId
    )
  )
    throw new PodcastError('SOURCE_DELETED');
  if (row.kind === 'pro' && (await planFor(row.userId, now)) !== 'pro')
    throw new PodcastError('PRO_EXPIRED');
  await atomic((q) => [
    guard({
      table: episode,
      column: 'id',
      where: eq(episode.id, row.id),
      require: sql`${episode.leaseToken} = ${row.leaseToken} and ${episode.status} = 'working' and ${episode.expiresAt} > ${sqlTime(now)}`,
      message: 'LEASE_LOST',
    }),
    ...records.map((s: any) =>
      guard({
        table: learningRecord,
        column: 'id',
        where: eq(learningRecord.id, s.record.id),
        require: sql`${learningRecord.deletedAt} is null`,
        message: 'SOURCE_DELETED',
      })
    ),
    q
      .update(episode)
      .set({
        status: 'ready',
        title: script.title,
        manifest: JSON.stringify(manifest),
        durationMs: manifest.reduce((s, r) => s + r.durationMs, 0),
        publishedAt: now,
        leaseToken: null,
        leaseUntil: null,
        errorCode: null,
      })
      .where(eq(episode.id, row.id)),
    q
      .update(pref)
      .set({
        activeEpisodeId: null,
        nextDueAt: new Date(now.getTime() + PODCAST_INTERVAL_MS),
        ...(row.kind === 'trial' ? { trialConsumedAt: now } : {}),
      })
      .where(eq(pref.userId, row.userId)),
    ...records.map((s: any) =>
      q
        .update(learningRecord)
        .set({ lastPodcastAt: now })
        .where(eq(learningRecord.id, s.record.id))
    ),
  ]);
}
export async function pendingIds(limit = 25) {
  return db()
    .select({ id: episode.id })
    .from(episode)
    .where(
      and(
        inArray(episode.status, ['queued', 'working', 'retry']),
        gt(episode.expiresAt, new Date()),
        sql`(${episode.retryAt} is null or ${episode.retryAt} <= ${sqlTime(new Date())})`,
        sql`(${episode.leaseUntil} is null or ${episode.leaseUntil} < ${sqlTime(new Date())})`
      )
    )
    .orderBy(asc(episode.createdAt))
    .limit(limit);
}
export async function schedule(limit = 25) {
  const due = await db()
    .select()
    .from(pref)
    .where(
      and(
        eq(pref.enabled, 1),
        isNull(pref.activeEpisodeId),
        sql`(${pref.scanAfter} is null or ${pref.scanAfter} <= ${sqlTime(new Date())})`,
        sql`(${pref.nextDueAt} is null or ${pref.nextDueAt} <= ${sqlTime(new Date())})`
      )
    )
    .orderBy(asc(pref.scanAfter))
    .limit(limit);
  for (const p of due) {
    try {
      if ((await planFor(p.userId)) === 'pro') await createEpisode(p.userId);
    } catch (error) {
      if (
        !(error instanceof PodcastError) &&
        !String(error).includes('PODCAST_ALREADY_RESERVED')
      )
        throw error;
    } finally {
      await db()
        .update(pref)
        .set({ scanAfter: new Date(Date.now() + 3600000) })
        .where(and(eq(pref.userId, p.userId), isNull(pref.activeEpisodeId)));
    }
  }
}
export async function retryEpisode(userId: string, id: string) {
  const row = await ownedEpisode(userId, id);
  if (
    !row ||
    row.manualRetries >= 3 ||
    !['failed', 'blocked'].includes(row.status)
  )
    throw new PodcastError('NOT_RETRYABLE');
  await db()
    .update(episode)
    .set({
      status: 'queued',
      attempts: 0,
      manualRetries: row.manualRetries + 1,
      retryAt: null,
      errorCode: null,
      ...(['AUDIO_TOO_LONG', 'AUDIO_DURATION_OUT_OF_RANGE'].includes(
        row.errorCode || ''
      )
        ? { script: null, manifest: null }
        : {}),
    })
    .where(
      and(
        eq(episode.id, id),
        eq(episode.status, row.status),
        eq(episode.manualRetries, row.manualRetries)
      )
    );
  return row;
}

export async function unknownMaterials(userId: string, page = 1) {
  return db()
    .select({
      id: learningRecord.id,
      text: learningRecord.text,
      context: learningRecord.context,
    })
    .from(learningRecord)
    .where(
      and(
        eq(learningRecord.userId, userId),
        isNull(learningRecord.deletedAt),
        isNull(learningRecord.sourceLanguage),
        gt(learningRecord.createdAt, new Date(Date.now() - 30 * 86400000))
      )
    )
    .orderBy(desc(learningRecord.createdAt))
    .limit(20)
    .offset((page - 1) * 20);
}
export async function confirmMaterialLanguage(
  userId: string,
  ids: string[],
  language: string
) {
  await db()
    .update(learningRecord)
    .set({ sourceLanguage: normalizePodcastLanguage(language) })
    .where(
      and(
        eq(learningRecord.userId, userId),
        isNull(learningRecord.deletedAt),
        isNull(learningRecord.sourceLanguage),
        inArray(learningRecord.id, ids)
      )
    );
}
