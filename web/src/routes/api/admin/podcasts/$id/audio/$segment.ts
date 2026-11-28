import { createFileRoute } from '@tanstack/react-router';
import { authenticateAdmin, requirePermission } from '@/server/admin/auth';
import { adminErrorResponse } from '@/server/admin/execute';
import { audioResponse } from '@/server/podcasts/api';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/core/db';
import { MAX_PODCAST_SEGMENTS } from '@/lib/podcast';
import { podcastEpisode } from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import { ownedEpisode } from '@/modules/podcasts/service';
import { respErr } from '@/lib/resp';

export async function handleAdminPodcastAudio(
  request: Request,
  id: string,
  segment: string
) {
  try {
    const actor = await authenticateAdmin(request);
    requirePermission(actor, 'admin.podcasts.read');
    const index = z.coerce.number().int().min(0).max(MAX_PODCAST_SEGMENTS - 1).parse(segment);
    const [owner] = await db()
      .select({ userId: podcastEpisode.userId })
      .from(podcastEpisode)
      .where(eq(podcastEpisode.id, id));
    const row = owner ? await ownedEpisode(owner.userId, id) : null;
    if (!row) return respErr('Not found', { status: 404 });
    return audioResponse(row, index, request, await getAllConfigs(), true);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
export const Route = createFileRoute('/api/admin/podcasts/$id/audio/$segment')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleAdminPodcastAudio(request, params.id, params.segment),
    },
  },
});
