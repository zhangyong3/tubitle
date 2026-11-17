import { createFileRoute } from '@tanstack/react-router';
import { guestPostFail, guestPostSession } from '@/server/guest-posts/api';
import { guestPostSettings } from '@/server/guest-posts/settings';
import { resolveCharge } from '@/server/payment/charge';

import { getAllConfigs } from '@/modules/config/service';
import {
  getPayableGuestPost,
  guestPostOrderReference,
} from '@/modules/guest-posts/service';
import { createCheckout } from '@/modules/payment/service';
import { localizedPath } from '@/lib/locale-path';
import { respData, respErr } from '@/lib/resp';

// Pay for a draft, which submits it for review. The package and price come
// from the submission and the catalog, never from the request; the payment
// webhook moves it into review (modules/payment → planGuestPostFulfillment).
// A rejection refunds the order.
async function POST({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = await guestPostSession(request, {
      keyPrefix: 'guest-post-checkout',
      intervalMs: 1_000,
    });
    if (auth.response) return auth.response;
    const configs = await getAllConfigs();
    const settings = guestPostSettings(configs);
    if (!settings.enabled) return respErr('Guest posts are not open');

    // Checks the saved article (length, link cap) before taking money.
    const { submission, post, pkg } = await getPayableGuestPost(
      params.id,
      auth.user.id,
      { minWords: settings.minWords }
    );
    const body = await request.json().catch(() => ({}));
    const charge = await resolveCharge({
      product: pkg,
      paymentProvider:
        typeof body.payment_provider === 'string'
          ? body.payment_provider
          : undefined,
      userId: auth.user.id,
      configs,
    });
    if ('error' in charge) return respErr(charge.error);

    const baseUrl = configs.app_url || 'http://localhost:3000';
    // Back to the submission, in the author's language (API URLs carry no
    // locale prefix, so the client sends it).
    const back = `${baseUrl}${localizedPath(`/settings/guest-posts/${submission.id}`, body.locale)}`;
    const checkout = await createCheckout({
      // The webhook finds the submission from the order's reference.
      reference: guestPostOrderReference(submission.id),
      userId: auth.user.id,
      userEmail: auth.user.email,
      productName: pkg.productName,
      planName: pkg.planName,
      credits: 0,
      paymentOrder: {
        productId: pkg.productId,
        price: { amount: charge.amount, currency: charge.currency },
        type: pkg.type,
        description: `${pkg.description}: ${(post.title || '').slice(0, 80)}`,
        successUrl: `${baseUrl}/api/payment/callback?redirect=${encodeURIComponent(back)}`,
        cancelUrl: back,
        customer: { email: auth.user.email, name: auth.user.name },
      },
      provider: charge.providerKey || undefined,
    });
    return respData({ checkout_url: checkout.checkoutInfo.checkoutUrl });
  } catch (error) {
    return guestPostFail(error);
  }
}

export const Route = createFileRoute('/api/guest-posts/$id/checkout')({
  server: { handlers: { POST } },
});
