import { planFor } from '@/lib/learning-plan';
import { createFileRoute } from '@tanstack/react-router';
import { readLearningBody } from '@/server/learning/api';

import { authorizeExtension } from '@/server/learning/extension-auth';
import * as learning from '@/modules/learning/service';
import { learningInput } from '@/lib/learning';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr, respJson } from '@/lib/resp';

export async function handleExtensionLearning(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: request.method === 'GET' ? 20 : 100,
    keyPrefix: 'extension-ip',
  });
  if (limited) return limited;
  try {
    const access = await authorizeExtension(request);
    if (access.response) return access.response;
    const userLimited = enforceMinIntervalRateLimit(request, {
      intervalMs: request.method === 'GET' ? 30 : 150,
      keyPrefix: 'extension-user',
      extraKey: access.userId,
    });
    if (userLimited) return userLimited;
    if (request.method === 'GET')
      return respData(
        { userId: access.userId, name: access.name, plan: await planFor(access.userId) },
        { headers }
      );
    const parsed = learningInput.safeParse(
      await readLearningBody(request, 262144)
    );
    if (!parsed.success || !parsed.data?.clientRecordId)
      return respErr('Invalid learning record', { status: 400, headers });
    await learning.create(access.userId, parsed.data, true);
    // Upload-only: do not expose the user's existing records to the extension.
    return respData(
      { saved: true, clientRecordId: parsed.data.clientRecordId },
      { headers }
    );
  } catch (error) {
    if (error instanceof learning.LearningQuotaError) return respJson(-1, error.message, { reason: error.reason }, { status: 403, headers });
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        ['Expected JSON', 'Missing body', 'Body too large'].includes(
          error.message
        ))
    )
      return respErr('Invalid request body', { status: 400, headers });
    return respErr('Unable to upload learning record', {
      status: 500,
      headers,
    });
  }
}
export const Route = createFileRoute('/api/extension/learning')({
  server: {
    handlers: {
      GET: ({ request }) => handleExtensionLearning(request),
      POST: ({ request }) => handleExtensionLearning(request),
    },
  },
});
