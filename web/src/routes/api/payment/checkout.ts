import { createFileRoute } from '@tanstack/react-router';
import { resolveCharge } from '@/server/payment/charge';

import { getAuth } from '@/core/auth';
import { getPricingProduct } from '@/config/pricing';
import { getAllConfigs } from '@/modules/config/service';
import { createCheckout } from '@/modules/payment/service';
import { localizedPath } from '@/lib/locale-path';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

function safeSameOriginPath(
  input: string | undefined | null,
  fallbackPath: string,
  baseUrl: string
): string {
  if (!input) return fallbackPath;
  try {
    const appUrl = new URL(baseUrl);
    const candidate = new URL(input, appUrl);
    if (candidate.origin !== appUrl.origin) return fallbackPath;
    return candidate.pathname + candidate.search + candidate.hash;
  } catch {
    return fallbackPath;
  }
}

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 1000,
    keyPrefix: 'checkout',
  });
  if (limited) return limited;

  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    // Per account too: one user can't sidestep the IP bucket by switching networks.
    const userLimited = enforceMinIntervalRateLimit(request, {
      intervalMs: 1000,
      keyPrefix: 'checkout',
      extraKey: session.user.id,
    });
    if (userLimited) return userLimited;

    const body = await request.json().catch(() => ({}));
    const { product_id, payment_provider, redirect, locale } = body;

    if (!product_id || typeof product_id !== 'string') {
      return respErr('Missing product_id');
    }

    // Look up product in the authoritative server-side catalog.
    // We DO NOT trust price / credits / plan from the request body.
    const product = getPricingProduct(product_id);
    if (!product) {
      return respErr('Unknown product');
    }
    // Guest post packages are bought against an approved submission only.
    if (product.kind === 'guest_post') {
      return respErr('Unknown product');
    }

    // Catalog price for the chosen provider (CNY providers, admin test
    // amounts): see resolveCharge.
    const configs = await getAllConfigs();
    const charge = await resolveCharge({
      product,
      paymentProvider: payment_provider,
      userId: session.user.id,
      configs,
    });
    if ('error' in charge) return respErr(charge.error);
    const chargeAmount = charge.amount;
    const currency = charge.currency;

    // Build success/cancel URLs — only accept same-origin redirects.
    const baseUrl = configs.app_url || 'http://localhost:3000';
    const safeRedirectPath = safeSameOriginPath(
      redirect,
      '/settings/payments',
      baseUrl
    );
    // Straight to the destination: safeSameOriginPath has already reduced it
    // to a path on this site. The old detour through /auth-callback exists to
    // hand a session token to a desktop client — a browser coming back from
    // checkout is already signed in, and that page isn't part of this app.
    // Back in the buyer's language (the API URL has no locale prefix).
    const finalRedirect = `${baseUrl}${localizedPath(safeRedirectPath, locale)}`;
    const successUrl = `${baseUrl}/api/payment/callback?redirect=${encodeURIComponent(finalRedirect)}`;
    const cancelUrl = `${baseUrl}${localizedPath('/pricing', locale)}`;

    const checkout = await createCheckout({
      userId: session.user.id,
      userEmail: session.user.email,
      productName: product.productName,
      planName: product.planName,
      credits: product.credits,
      creditsValidDays: product.creditsValidDays,
      paymentOrder: {
        productId: product.productId,
        price: { amount: chargeAmount, currency },
        type: product.type,
        description: product.description,
        successUrl,
        cancelUrl,
        customer: {
          email: session.user.email,
          name: session.user.name,
        },
        plan: product.plan
          ? {
              name: product.plan.name,
              interval: product.plan.interval,
              intervalCount: product.plan.intervalCount,
            }
          : undefined,
      },
      provider: payment_provider,
    });

    return respData({ checkout_url: checkout.checkoutInfo.checkoutUrl });
  } catch (error: any) {
    console.error('checkout error:', error);
    return respErr(error.message || 'Checkout failed');
  }
}

export const Route = createFileRoute('/api/payment/checkout')({
  server: {
    handlers: { POST },
  },
});
