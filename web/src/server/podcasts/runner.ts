import { and, eq, lte, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import {
  adminExecution,
  learningActivity,
  memberUsageDay,
  podcastEpisode,
  podcastPreference,
  podcastSource,
} from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import * as service from '@/modules/podcasts/service';
import { getUuid } from '@/lib/hash';
import { planFor } from '@/lib/learning-plan';
import {
  DAY_MS,
  oldestUsageDay,
  type AudioSegment,
  type PodcastScript,
} from '@/lib/podcast';
import { sqlTime } from '@/lib/podcast-db';

import { generateScript, synthesize, ttsLanguage } from './provider';
import {
  deleteEpisodeAudio,
  localAudio,
  sweepLocalOrphans,
  writeAudio,
} from './storage';

export type Providers = {
  script: typeof generateScript;
  speech: typeof synthesize;
  write: typeof writeAudio;
  remove: typeof deleteEpisodeAudio;
};
const defaults: Providers = {
  script: generateScript,
  speech: synthesize,
  write: writeAudio,
  remove: deleteEpisodeAudio,
};
export async function runEpisode(
  id: string,
  config: Record<string, string>,
  providers: Providers = defaults
) {
  const row = await service.claim(id);
  if (!row) return;
  try {
    ttsLanguage(row.sourceLanguage);
    ttsLanguage(row.translationLanguage);
    if (row.kind === 'pro' && (await planFor(row.userId)) !== 'pro')
      throw new Error('PRO_EXPIRED');
    const records = await service.sourcesFor(id);
    if (
      records.length < 5 ||
      records.some(
        (s: any) => s.record.deletedAt || s.record.userId !== row.userId
      )
    )
      throw new Error('SOURCE_DELETED');
    if (!row.script) {
      const script = await providers.script(
        records.map((s: any) => s.record),
        row.sourceLanguage,
        row.translationLanguage,
        config
      );
      await service.checkpoint(id, row.leaseToken, {
        script: JSON.stringify(script),
        title: script.title,
        status: 'queued',
        attempts: 0,
      });
      return;
    }
    const script: PodcastScript = JSON.parse(row.script);
    const manifest: AudioSegment[] = JSON.parse(row.manifest || '[]');
    const index = manifest.length;
    if (index < script.segments.length) {
      const segment = script.segments[index];
      const { audio, durationMs } = await providers.speech(
        segment.spokenText,
        segment.language,
        config,
        { literal: row.attempts > 0 }
      );
      if (
        durationMs > 90000 ||
        manifest.reduce((n, s) => n + s.durationMs, 0) + durationMs > 360000
      )
        throw new Error('AUDIO_TOO_LONG');
      // Each claim writes a unique prefix, so an expired lease never overwrites the winning audio.
      const key = `podcasts/${id}/${getUuid()}/${index}.mp3`;
      const latest = await service.ownedEpisode(row.userId, id);
      if (latest?.leaseToken !== row.leaseToken) throw new Error('LEASE_LOST');
      await providers.write(key, audio, config);
      manifest.push({ key, durationMs });
      await service.checkpoint(id, row.leaseToken, {
        manifest: JSON.stringify(manifest),
        status: 'queued',
        attempts: 0,
      });
      return;
    }
    const duration = manifest.reduce((n, s) => n + s.durationMs, 0);
    if (duration <= 0 || duration > 360000)
      throw new Error('AUDIO_DURATION_OUT_OF_RANGE');
    await service.publish(row, script, manifest);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'GENERATION_FAILED';
    const safe = /^[A-Z_]{3,60}$/.test(code) ? code : 'GENERATION_FAILED';
    const blocked = safe === 'PRO_EXPIRED';
    const terminal = [
      'SOURCE_DELETED',
      'AUDIO_TOO_LONG',
      'AUDIO_DURATION_OUT_OF_RANGE',
      'TTS_LANGUAGE_UNSUPPORTED',
    ].includes(safe);
    await service
      .checkpoint(id, row.leaseToken, {
        status: blocked
          ? 'blocked'
          : terminal || row.attempts >= 2
            ? 'failed'
            : 'retry',
        attempts: row.attempts + 1,
        errorCode: safe,
        retryAt: new Date(Date.now() + 60000 * 2 ** row.attempts),
      })
      .catch(() => undefined);
  }
}
export async function cleanupEpisode(
  id: string,
  config: Record<string, string>,
  remove = deleteEpisodeAudio,
  now = new Date()
) {
  const [row] = await db()
    .select({
      id: podcastEpisode.id,
      userId: podcastEpisode.userId,
      status: podcastEpisode.status,
      expiresAt: podcastEpisode.expiresAt,
    })
    .from(podcastEpisode)
    .where(eq(podcastEpisode.id, id));
  if (!row || (row.expiresAt > now && row.status !== 'deleting')) return;
  await service.markDeleting(row.userId, row.id);
  await remove(row.id, config);
  await db().delete(podcastSource).where(eq(podcastSource.episodeId, row.id));
  await db()
    .update(podcastPreference)
    .set({ activeEpisodeId: null })
    .where(eq(podcastPreference.activeEpisodeId, row.id));
  await db()
    .delete(podcastEpisode)
    .where(
      and(eq(podcastEpisode.id, row.id), eq(podcastEpisode.status, 'deleting'))
    );
}
export async function cleanup(
  config: Record<string, string>,
  remove = deleteEpisodeAudio,
  now = new Date(),
  enqueue?: (id: string) => Promise<void>
) {
  const rows = await db()
    .select({ id: podcastEpisode.id, userId: podcastEpisode.userId })
    .from(podcastEpisode)
    .where(
      sql`${podcastEpisode.expiresAt} <= ${sqlTime(now)} or ${podcastEpisode.status} = 'deleting'`
    )
    .limit(100);
  let failed = 0;
  for (const row of rows) {
    await service.markDeleting(row.userId, row.id);
    try {
      if (enqueue) await enqueue(row.id);
      else await cleanupEpisode(row.id, config, remove, now);
    } catch {
      failed++;
    }
  }
  await db()
    .delete(adminExecution)
    .where(
      and(
        sql`${adminExecution.operation} in ('users_usage', 'users_podcasts')`,
        lte(adminExecution.createdAt, new Date(now.getTime() - 30 * DAY_MS))
      )
    );
  await db()
    .delete(memberUsageDay)
    .where(sql`${memberUsageDay.day} < ${oldestUsageDay(now)}`);
  await db()
    .delete(learningActivity)
    .where(
      sql`${learningActivity.day} < ${new Date(now.getTime() - 6 * DAY_MS).toISOString().slice(0, 10)}`
    );
  if (localAudio(config)) {
    const ids = await db()
      .select({ id: podcastEpisode.id })
      .from(podcastEpisode);
    await sweepLocalOrphans(new Set(ids.map((r: any) => r.id)), now);
  }
  return { processed: rows.length, failed };
}
export async function tick() {
  const config = await getAllConfigs();
  await cleanup(config);
  if (config.podcast_enabled !== 'true') return;
  await service.schedule();
  for (const row of await service.pendingIds(10))
    await runEpisode(row.id, config);
}
