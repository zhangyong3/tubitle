import { createFileRoute } from '@tanstack/react-router';
import { authorizeLearning, readLearningBody } from '@/server/learning/api';
import { z } from 'zod';

import * as learning from '@/modules/learning/service';
import { learningUpdate } from '@/lib/learning';
import { respData, respErr, respOk } from '@/lib/resp';

export async function handleLearning(request: Request) {
  if (!['GET', 'PATCH', 'DELETE'].includes(request.method)) return respErr('Method not allowed', { status: 405 });
  const access = await authorizeLearning(request);
  if (access.response) return access.response;
  const userId = access.userId!;
  const headers = { 'cache-control': 'private, no-store' };
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') {
      const parsed = z
        .object({
          search: z.string().max(100).optional(),
          kind: z.enum(['word', 'sentence']).optional(),
          status: z.enum(['new', 'learning', 'mastered']).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success)
        return respErr('Invalid filters', { status: 400, headers });
      return respData(await learning.list(userId, parsed.data), { headers });
    }
    if (request.method === 'PATCH') {
      const parsed = learningUpdate.safeParse(await readLearningBody(request));
      if (!parsed.success)
        return respErr('Invalid update', { status: 400, headers });
      const item = await learning.updateStatus(
        userId,
        parsed.data.id,
        parsed.data.status
      );
      return item
        ? respData(item, { headers })
        : respErr('Not found', { status: 404, headers });
    }
    const id = url.searchParams.get('id');
    if (!id || id.length > 100)
      return respErr('Invalid ID', { status: 400, headers });
    await learning.remove(userId, id);
    return respOk({ headers });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        ['Expected JSON', 'Missing body', 'Body too large'].includes(
          error.message
        ))
    )
      return respErr('Invalid request body', { status: 400, headers });
    console.error('[learning] request failed');
    return respErr('Unable to save or load learning records', {
      status: 500,
      headers,
    });
  }
}
export const Route = createFileRoute('/api/learning')({
  server: {
    handlers: {
      GET: ({ request }) => handleLearning(request),
      PATCH: ({ request }) => handleLearning(request),
      DELETE: ({ request }) => handleLearning(request),
    },
  },
});
