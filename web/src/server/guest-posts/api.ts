import { getAuth } from '@/core/auth';
import { GuestPostError } from '@/modules/guest-posts/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr } from '@/lib/resp';

/**
 * Session for an author API call, rate-limited by IP before auth and by user
 * after. Returns a Response to send back instead when the call can't proceed.
 */
export async function guestPostSession(
  request: Request,
  limit?: { keyPrefix: string; intervalMs: number }
) {
  if (limit) {
    const byIp = enforceMinIntervalRateLimit(request, limit);
    if (byIp) return { response: byIp };
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return { response: respErr('Unauthorized') };
  if (limit) {
    const byUser = enforceMinIntervalRateLimit(request, {
      ...limit,
      extraKey: session.user.id,
    });
    if (byUser) return { response: byUser };
  }
  return { user: session.user };
}

export function guestPostFail(error: any) {
  if (error instanceof GuestPostError) return respErr(error.message);
  console.error('[guest-posts]', error);
  return respErr('Something went wrong');
}

/** Author-editable fields from a request body. */
export function articleInput(body: any) {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    title: str(body.title),
    slug: str(body.slug),
    description: str(body.description),
    image: str(body.image),
    content: str(body.content),
  };
}
