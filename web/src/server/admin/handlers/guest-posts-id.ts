import { getPricingProduct } from '@/config/pricing';
import {
  adminEditGuestPost,
  getGuestPost,
  GuestPostError,
  restoreGuestPost,
  reviewGuestPost,
  setRejectionNote,
  unpublishGuestPost,
  type RestoreAction,
  type ReviewAction,
} from '@/modules/guest-posts/service';
import { refundOrder } from '@/modules/payment/service';
import { respData, respErr, respOk } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const ACTIONS: ReviewAction[] = ['approve', 'request_changes'];

function fail(error: any) {
  if (error instanceof GuestPostError) return respErr(error.message);
  return respErr(error?.message || 'Internal error');
}

export async function GET({ params }: AdminHandlerContext) {
  try {
    const row = await getGuestPost(params.id);
    if (!row) return respErr('Guest post not found');
    const pkg = getPricingProduct(row.submission.productId);
    return respData({
      ...row,
      package: pkg
        ? {
            productId: pkg.productId,
            planName: pkg.planName,
            maxLinks: pkg.maxLinks ?? 0,
            priceInCents: pkg.priceInCents,
            currency: pkg.currency,
          }
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}

// Review a paid submission: approve (publishes it) or request changes.
export async function POST({ request, params }: AdminHandlerContext) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as ReviewAction;
    if (!ACTIONS.includes(action)) return respErr('Invalid action');
    const note = typeof body.note === 'string' ? body.note : '';
    const row = await reviewGuestPost({ id: params.id, action, note });
    return respOk();
  } catch (error) {
    return fail(error);
  }
}

// Reject a paid submission: refund its order, which marks it rejected in the
// same write (modules/payment → planGuestPostRefund). Dedicated permission.
export async function REJECT({ request, params, actor }: AdminHandlerContext) {
  try {
    const body = await request.json().catch(() => ({}));
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) return respErr('Tell the author why');
    const row = await getGuestPost(params.id);
    if (!row) return respErr('Guest post not found');
    const { status, orderNo } = row.submission;
    if (
      (status !== 'submitted' && status !== 'changes_requested') ||
      !orderNo
    ) {
      return respErr(
        'Only paid submissions awaiting a decision can be rejected'
      );
    }
    await refundOrder({
      orderNo,
      operatorId: actor.userId,
      reason: `Guest post rejected: ${note}`.slice(0, 500),
    });
    await setRejectionNote(params.id, note);
    return respOk();
  } catch (error) {
    return fail(error);
  }
}

// Edit the article.
export async function PUT({ request, params }: AdminHandlerContext) {
  try {
    const body = await request.json().catch(() => ({}));
    await adminEditGuestPost(params.id, {
      title: body.title,
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      description: body.description,
      image: body.image,
      content: body.content,
    });
    return respOk();
  } catch (error) {
    return fail(error);
  }
}

// Unpublish.
export async function PATCH({ request, params }: AdminHandlerContext) {
  try {
    const body = await request.json().catch(() => ({}));
    await unpublishGuestPost(
      params.id,
      typeof body.note === 'string' ? body.note : undefined
    );
    return respOk();
  } catch (error) {
    return fail(error);
  }
}

// Restore an unpublished guest post whose order is still paid: republish it
// or send it back to the author for changes.
export async function RESTORE({ request, params }: AdminHandlerContext) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as RestoreAction;
    if (action !== 'republish' && action !== 'request_changes') {
      return respErr('Invalid action');
    }
    const note = typeof body.note === 'string' ? body.note : '';
    const row = await restoreGuestPost({ id: params.id, action, note });
    return respOk();
  } catch (error) {
    return fail(error);
  }
}
