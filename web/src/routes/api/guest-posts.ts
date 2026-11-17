import { createFileRoute } from '@tanstack/react-router';
import {
  articleInput,
  guestPostFail,
  guestPostSession,
} from '@/server/guest-posts/api';
import { guestPostSettings } from '@/server/guest-posts/settings';

import { getAllConfigs } from '@/modules/config/service';
import {
  createGuestPost,
  GuestPostStatus,
  listUserGuestPosts,
} from '@/modules/guest-posts/service';
import { respData, respErr, respPage } from '@/lib/resp';

const STATUSES: string[] = Object.values(GuestPostStatus);

// The signed-in author's own submissions.
async function GET({ request }: { request: Request }) {
  try {
    const auth = await guestPostSession(request);
    if (auth.response) return auth.response;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const status = searchParams.get('status') || '';
    const { items, total } = await listUserGuestPosts(auth.user.id, {
      status: STATUSES.includes(status) ? status : undefined,
      search: searchParams.get('search') || undefined,
      page,
      pageSize,
    });
    return respPage(items, total);
  } catch (error) {
    return guestPostFail(error);
  }
}

// New draft. It enters review when the author pays for it (checkout).
async function POST({ request }: { request: Request }) {
  try {
    const auth = await guestPostSession(request, {
      keyPrefix: 'guest-post-create',
      intervalMs: 10_000,
    });
    if (auth.response) return auth.response;
    const settings = guestPostSettings(await getAllConfigs());
    if (!settings.enabled) return respErr('Guest posts are not open');

    const body = await request.json().catch(() => ({}));
    const id = await createGuestPost({
      userId: auth.user.id,
      authorName: auth.user.name || '',
      authorImage: auth.user.image,
      productId: typeof body.productId === 'string' ? body.productId : '',
      input: articleInput(body),
    });
    return respData({ id });
  } catch (error) {
    return guestPostFail(error);
  }
}

export const Route = createFileRoute('/api/guest-posts')({
  server: { handlers: { GET, POST } },
});
