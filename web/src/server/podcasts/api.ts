import { authorizeLearning, readLearningBody } from '@/server/learning/api';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/core/db';
import { user } from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import * as service from '@/modules/podcasts/service';
import { planFor } from '@/lib/learning-plan';
import { languageCode, MAX_PODCAST_SEGMENTS, PodcastError } from '@/lib/podcast';
import { respData, respErr } from '@/lib/resp';

import { ttsLanguage } from './provider';
import { readAudio } from './storage';

const headers = { 'cache-control': 'private, no-store' };
export function publicEpisode(row: any) {
  if (!row) return null;
  const { leaseToken, leaseUntil, ...rest } = row;
  return {
    ...rest,
    script: row.script ? JSON.parse(row.script) : null,
    manifest: JSON.parse(row.manifest || '[]').map((s: any) => ({
      durationMs: s.durationMs,
    })),
  };
}
export async function audioResponse(
  row: any,
  index: number,
  request: Request,
  config: Record<string, string>,
  admin = false
) {
  if (row.status !== 'ready' || row.expiresAt <= new Date())
    return respErr('Not found', { status: 404, headers });
  const manifest = JSON.parse(row.manifest || '[]');
  if (!manifest[index]) return respErr('Not found', { status: 404, headers });
  const bytes = await readAudio(manifest[index].key, config);
  // Re-check after storage I/O; expiration and deletion can occur while reading.
  const fresh = await service.ownedEpisode(row.userId, row.id);
  if (!fresh || fresh.status !== 'ready')
    return respErr('Not found', { status: 404, headers });
  const h = new Headers({
    ...headers,
    'content-type': 'audio/mpeg',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  });
  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${bytes.length}` },
      });
    let start = m[1] ? Number(m[1]) : Math.max(0, bytes.length - Number(m[2]));
    let end = m[1]
      ? m[2]
        ? Math.min(Number(m[2]), bytes.length - 1)
        : bytes.length - 1
      : bytes.length - 1;
    if (!Number.isSafeInteger(start) || start >= bytes.length || end < start)
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${bytes.length}` },
      });
    h.set('content-range', `bytes ${start}-${end}/${bytes.length}`);
    h.set('content-length', String(end - start + 1));
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: h,
    });
  }
  h.set('content-length', String(bytes.length));
  return new Response(new Uint8Array(bytes).buffer, { headers: h });
}
export async function handlePodcasts(
  request: Request,
  id?: string,
  segment?: string
) {
  const access = await authorizeLearning(request);
  if (access.response) return access.response;
  const userId = access.userId!;
  try {
    if (id) {
      const row = await service.ownedEpisode(userId, id);
      if (!row) return respErr('Not found', { status: 404, headers });
      if (segment !== undefined)
        return audioResponse(
          row,
          z.coerce.number().int().min(0).max(MAX_PODCAST_SEGMENTS - 1).parse(segment),
          request,
          await getAllConfigs()
        );
      if (request.method === 'GET')
        return respData(
          {
            episode: publicEpisode(row),
            sources: (await service.sourcesFor(id)).map((s: any) => ({
              id: s.record.id,
              text: s.record.text,
              videoId: s.record.videoId,
              startSeconds: s.record.startSeconds,
            })),
          },
          { headers }
        );
      if (request.method === 'DELETE') {
        await service.markDeleting(userId, id);
        return respData({ deleted: true }, { headers });
      }
      if (request.method === 'POST') {
        await service.retryEpisode(userId, id);
        return respData({ queued: true }, { headers });
      }
      const body = z
        .object({
          client: z.string().uuid(),
          sequence: z.number().int().min(1).max(2147483647),
          segment: z.number().int().min(0).max(MAX_PODCAST_SEGMENTS - 1),
          offset: z.number().int().min(0).max(90000),
          deltaMs: z.number().int().min(0).max(30000),
        })
        .strict()
        .parse(await readLearningBody(request, 4096));
      await service.updateProgress(userId, id, body);
      return respData({ saved: true }, { headers });
    }
    if (request.method === 'GET') {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(new URL(request.url).searchParams.get('page') || 1);
      const [p, plan, rows, account] = await Promise.all([
        service.preference(userId),
        planFor(userId),
        service.listEpisodes(userId, page),
        db()
          .select({ notice: user.podcastLanguageNotice })
          .from(user)
          .where(eq(user.id, userId)),
      ]);
      return respData(
        {
          preference: p,
          plan,
          notice: !!account[0]?.notice,
          episodes: rows.map(publicEpisode),
          page,
        },
        { headers }
      );
    }
    if (request.method === 'PATCH') {
      const body = z
        .object({
          language: languageCode.optional(),
          enabled: z.boolean().optional(),
          dismissNotice: z.boolean().optional(),
        })
        .strict()
        .parse(await readLearningBody(request, 4096));
      if (body.language) ttsLanguage(body.language);
      return respData(await service.setPreference(userId, body), { headers });
    }
    const config = await getAllConfigs();
    if (config.podcast_enabled !== 'true')
      throw new PodcastError('PODCAST_NOT_CONFIGURED', 503);
    const p = await service.preference(userId);
    ttsLanguage(p.language);
    const selected = await service.selectSources(userId);
    ttsLanguage(selected.language);
    return respData(publicEpisode(await service.createEpisode(userId)), {
      headers,
    });
  } catch (error) {
    if (error instanceof PodcastError)
      return respErr(error.code, { status: error.status, headers });
    if (error instanceof z.ZodError)
      return respErr('Invalid request', { status: 400, headers });
    return respErr('PODCAST_REQUEST_FAILED', { status: 409, headers });
  }
}
