import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { parseClientEvent, recordEvent } from '@/modules/events/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr, respOk } from '@/lib/resp';

// Browser-reported product events (track() in @/lib/track). Only kinds
// registered with `client: true` in src/config/events.ts are accepted, for
// signed-in users, from this site's own pages.
async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 200,
    keyPrefix: 'events',
  });
  if (limited) return limited;

  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    return respErr('Same-origin request required', { status: 403 });

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const parsed = parseClientEvent(await request.json().catch(() => null));
    if ('error' in parsed)
      return respErr(parsed.error, { status: parsed.status });

    // One event of each kind per user every 2s keeps a looping page (or a
    // script) from flooding the table.
    const userLimited = enforceMinIntervalRateLimit(request, {
      intervalMs: 2000,
      keyPrefix: `events:${parsed.kind}`,
      extraKey: session.user.id,
    });
    if (userLimited) return userLimited;

    await recordEvent({
      userId: session.user.id,
      kind: parsed.kind,
      detail: parsed.detail,
      source: 'client',
    });
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/events')({
  server: { handlers: { POST } },
});
