import { createFileRoute } from '@tanstack/react-router';
import { authorizeLearning, readLearningBody } from '@/server/learning/api';
import { ttsLanguage } from '@/server/podcasts/provider';
import { z } from 'zod';

import {
  confirmMaterialLanguage,
  unknownMaterials,
} from '@/modules/podcasts/service';
import { languageCode } from '@/lib/podcast';
import { respData, respErr } from '@/lib/resp';

async function handle(request: Request) {
  const access = await authorizeLearning(request);
  if (access.response) return access.response;
  const headers = { 'cache-control': 'private, no-store' };
  try {
    if (request.method === 'GET') {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(new URL(request.url).searchParams.get('page') || 1);
      return respData(await unknownMaterials(access.userId!, page), {
        headers,
      });
    }
    const body = z
      .object({
        ids: z.array(z.string().min(1).max(191)).min(1).max(20),
        language: languageCode,
      })
      .strict()
      .parse(await readLearningBody(request, 8192));
    ttsLanguage(body.language);
    await confirmMaterialLanguage(access.userId!, body.ids, body.language);
    return respData({ saved: true }, { headers });
  } catch {
    return respErr('Invalid language confirmation', { status: 400, headers });
  }
}
export const Route = createFileRoute('/api/podcasts/materials')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      PATCH: ({ request }) => handle(request),
    },
  },
});
