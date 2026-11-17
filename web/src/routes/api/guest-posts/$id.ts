import { createFileRoute } from '@tanstack/react-router';
import {
  articleInput,
  guestPostFail,
  guestPostSession,
} from '@/server/guest-posts/api';
import { guestPostSettings } from '@/server/guest-posts/settings';

import { getAllConfigs } from '@/modules/config/service';
import {
  deleteGuestPost,
  getGuestPost,
  updateGuestPost,
} from '@/modules/guest-posts/service';
import { notifyGuestPostSubmitted } from '@/modules/notify/service';
import { respData, respErr, respOk } from '@/lib/resp';

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = await guestPostSession(request);
    if (auth.response) return auth.response;
    const row = await getGuestPost(params.id, auth.user.id);
    if (!row) return respErr('Not found');
    return respData({ submission: row.submission, post: row.post });
  } catch (error) {
    return guestPostFail(error);
  }
}

// Edit. body.resubmit sends a changes-requested (paid) submission back to
// review; drafts enter review by paying (checkout).
async function PUT({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = await guestPostSession(request, {
      keyPrefix: 'guest-post-update',
      intervalMs: 2_000,
    });
    if (auth.response) return auth.response;
    const settings = guestPostSettings(await getAllConfigs());
    if (!settings.enabled) return respErr('Guest posts are not open');

    const body = await request.json().catch(() => ({}));
    const resubmit = body.resubmit === true;
    await updateGuestPost({
      id: params.id,
      userId: auth.user.id,
      productId: typeof body.productId === 'string' ? body.productId : '',
      input: articleInput(body),
      resubmit,
      minWords: settings.minWords,
    });
    if (resubmit) await notifyGuestPostSubmitted(params.id, 'resubmitted');
    return respOk();
  } catch (error) {
    return guestPostFail(error);
  }
}

async function DELETE({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = await guestPostSession(request, {
      keyPrefix: 'guest-post-delete',
      intervalMs: 1_000,
    });
    if (auth.response) return auth.response;
    await deleteGuestPost(params.id, auth.user.id);
    return respOk();
  } catch (error) {
    return guestPostFail(error);
  }
}

export const Route = createFileRoute('/api/guest-posts/$id')({
  server: { handlers: { GET, PUT, DELETE } },
});
