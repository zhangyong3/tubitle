import { audioResponse, publicEpisode } from '@/server/podcasts/api';

import { getAllConfigs } from '@/modules/config/service';
import { usageFor } from '@/modules/member-usage/service';
import {
  listEpisodes,
  ownedEpisode,
  sourcesFor,
} from '@/modules/podcasts/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

export async function usage({ request }: AdminHandlerContext) {
  return respData(
    await usageFor(new URL(request.url).searchParams.get('userId')!),
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
export async function podcasts({ request }: AdminHandlerContext) {
  const q = new URL(request.url).searchParams;
  const userId = q.get('userId')!;
  const id = q.get('id');
  if (id) {
    const row = await ownedEpisode(userId, id);
    if (!row) return respErr('Not found', { status: 404 });
    return respData(
      {
        episode: publicEpisode(row),
        sources: (await sourcesFor(id)).map((s: any) => ({
          id: s.record.id,
          text: s.record.text,
        })),
      },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  }
  return respData(
    (await listEpisodes(userId, Number(q.get('page') || 1))).map(publicEpisode),
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
