import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic, AtomicGuardError, guard } from '@/core/db/atomic';
import {
  AlipayProvider,
  CreemProvider,
  PaymentManager,
  StripeProvider,
  WechatPayProvider,
} from '@/core/payment';
import {
  PaymentStatus,
  PaymentType,
  SubscriptionCycleType,
  type CheckoutSession,
  type PaymentEvent,
  type PaymentOrder,
  type PaymentRefund,
} from '@/core/payment/types';
import { credit, order, subscription } from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import {
  calculateCreditExpirationTime,
  planDeductForRefund,
} from '@/modules/credits/service';
import {
  planGuestPostFulfillment,
  planGuestPostRefund,
} from '@/modules/guest-posts/service';
import {
  notifyGuestPostSubmitted,
  notifyPaymentSuccess,
} from '@/modules/notify/service';
import {
  findByProviderSubscriptionId,
  findBySubscriptionNo,
  SubscriptionStatus,
  updateBySubscriptionNo,
  type NewSubscription,
  type UpdateSubscription,
} from '@/modules/subscriptions/service';
import { getSnowId, getUniSeq, getUuid } from '@/lib/hash';

// --- Order types ---

enum OrderStatus {
  PENDING = 'pending',
  CREATED = 'created',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDING = 'refunding', // claimed by an in-flight refund
  REFUNDED = 'refunded',
}

// A refund stuck in REFUNDING (crash between provider call and DB commit) can
// be retried after this long; provider idempotency keys make the retry safe.
const REFUND_STALE_MS = 5 * 60 * 1000;

// --- Payment Manager ---

let manager: PaymentManager | null = null;
let managerConfigHash = '';

async function getPaymentManager(): Promise<PaymentManager> {
  const configs = await getAllConfigs();
  const c = (key: string) => configs[key] || '';

  // Rebuild manager if provider configs changed
  const hash = JSON.stringify([
    c('stripe_secret_key') || c('stripe_api_key'),
    c('creem_enabled'),
    c('creem_api_key'),
    c('alipay_app_id'),
    c('wechat_mch_id'),
    c('default_payment_provider'),
  ]);
  if (manager && hash === managerConfigHash) return manager;

  manager = new PaymentManager();
  managerConfigHash = hash;

  const stripeKey = c('stripe_secret_key') || c('stripe_api_key');
  if (stripeKey) {
    const isDefault =
      !c('default_payment_provider') ||
      c('default_payment_provider') === 'stripe';
    manager.addProvider(
      new StripeProvider({
        secretKey: stripeKey,
        publishableKey: c('stripe_publishable_key'),
        signingSecret:
          c('stripe_signing_secret') || c('stripe_webhook_secret') || undefined,
        allowPromotionCodes: true,
        allowedPaymentMethods: ['card', 'wechat_pay', 'alipay'],
      }),
      isDefault
    );
  }

  if (c('creem_enabled') === 'true' && c('creem_api_key')) {
    const isDefault = c('default_payment_provider') === 'creem';
    manager.addProvider(
      new CreemProvider({
        apiKey: c('creem_api_key'),
        signingSecret: c('creem_signing_secret') || undefined,
        environment:
          c('creem_environment') === 'production' ? 'production' : 'sandbox',
      }),
      isDefault
    );
  }

  if (c('alipay_app_id') && c('alipay_private_key')) {
    const isDefault = c('default_payment_provider') === 'alipay';
    manager.addProvider(
      new AlipayProvider({
        appId: c('alipay_app_id'),
        privateKey: c('alipay_private_key'),
        alipayPublicKey: c('alipay_public_key'),
        notifyUrl: c('alipay_notify_url') || undefined,
      }),
      isDefault
    );
  }

  if (c('wechat_mch_id') && c('wechat_private_key')) {
    const isDefault = c('default_payment_provider') === 'wechat';
    manager.addProvider(
      new WechatPayProvider({
        appId: c('wechat_app_id'),
        mchId: c('wechat_mch_id'),
        apiV3Key: c('wechat_api_v3_key'),
        privateKey: c('wechat_private_key'),
        serialNo: c('wechat_serial_no'),
        notifyUrl: c('wechat_notify_url') || undefined,
        platformCert: c('wechat_platform_cert') || undefined,
      }),
      isDefault
    );
  }

  return manager;
}

// --- Checkout ---

export async function createCheckout(params: {
  userId: string;
  userEmail?: string;
  paymentOrder: PaymentOrder;
  provider?: string;
  productName?: string;
  planName?: string;
  credits?: number;
  creditsValidDays?: number;
  /** What the order buys beyond productId, `<kind>:<id>` (order.reference). */
  reference?: string;
}): Promise<CheckoutSession> {
  const {
    userId,
    userEmail,
    paymentOrder,
    provider,
    productName,
    planName,
    credits,
    creditsValidDays,
  } = params;
  const pm = await getPaymentManager();
  const orderNo = getUniSeq('ORD');
  const configs = await getAllConfigs();
  const appUrl = configs.app_url || 'http://localhost:3000';

  // Resolve provider-specific product ID (e.g. Creem product_ids_mapping)
  const resolvedProvider = provider || pm.getDefaultProvider()?.name;
  let resolvedProductId = paymentOrder.productId;
  if (resolvedProvider === 'creem' && paymentOrder.productId) {
    const mapping = configs.creem_product_ids_mapping;
    if (mapping) {
      try {
        const map = JSON.parse(mapping) as Record<string, string>;
        if (map[paymentOrder.productId]) {
          resolvedProductId = map[paymentOrder.productId];
        }
      } catch {
        // invalid JSON — fall through with original productId
      }
    }
  }

  const finalSuccessUrl =
    paymentOrder.successUrl || `${appUrl}/settings/payments`;
  const callbackSuccessUrl = `${appUrl}/api/payment/callback?order_no=${orderNo}&redirect=${encodeURIComponent(finalSuccessUrl)}`;

  const session = await pm.createPayment({
    order: {
      ...paymentOrder,
      productId: resolvedProductId,
      orderNo,
      successUrl: callbackSuccessUrl,
      cancelUrl:
        paymentOrder.cancelUrl || `${appUrl}/settings/billing?canceled=1`,
    },
    provider,
  });

  await db()
    .insert(order)
    .values({
      id: getUuid(),
      orderNo,
      userId,
      userEmail: userEmail || '',
      status: OrderStatus.CREATED,
      amount: paymentOrder.price?.amount || 0,
      currency: paymentOrder.price?.currency || 'usd',
      productId: paymentOrder.productId || '',
      productName: productName || null,
      planName: planName || null,
      creditsAmount: credits ?? null,
      creditsValidDays: creditsValidDays ?? null,
      paymentType: paymentOrder.type || 'one-time',
      paymentInterval: paymentOrder.plan?.interval || null,
      paymentProvider: session.provider,
      paymentSessionId: session.checkoutInfo.sessionId,
      checkoutInfo: JSON.stringify(session.checkoutInfo),
      checkoutResult: JSON.stringify(session.checkoutResult),
      checkoutUrl: session.checkoutInfo.checkoutUrl,
      description: paymentOrder.description || '',
      reference: params.reference || null,
    });

  return session;
}

// --- Payment callback (return_url) ---

export async function handlePaymentCallback(orderNo: string) {
  // Find the order
  const [existingOrder] = await db()
    .select()
    .from(order)
    .where(eq(order.orderNo, orderNo))
    .limit(1);

  if (!existingOrder) return;
  if (existingOrder.status === OrderStatus.PAID) return;

  // Query the payment provider for latest status
  const pm = await getPaymentManager();
  const provider = pm.getProvider(existingOrder.paymentProvider);
  if (!provider) return;

  const session = await provider.getPaymentSession({
    sessionId: existingOrder.paymentSessionId || existingOrder.orderNo,
  });

  // Reuse the same atomic success handler as the webhook so that
  // subscriptions are created and credits granted on synchronous return too.
  // This is important in environments where webhooks aren't reachable (e.g. localhost).
  await handleCheckoutSuccess(session, existingOrder.paymentProvider);
}

// --- Webhook handling ---

export async function handleWebhook(params: {
  req: Request;
  provider: string;
}): Promise<PaymentEvent> {
  const pm = await getPaymentManager();
  const event = await pm.getPaymentEvent({
    req: params.req,
    provider: params.provider,
  });
  const session = event.paymentSession;
  if (!session) return event;

  const eventType = event.eventType;

  // Route event to appropriate handler
  if (eventType === 'checkout.success') {
    await handleCheckoutSuccess(session, params.provider);
  } else if (eventType === 'payment.success') {
    if (
      session.paymentInfo?.subscriptionCycleType ===
      SubscriptionCycleType.RENEWAL
    ) {
      await handleSubscriptionRenewal(session, params.provider);
    } else {
      await handleCheckoutSuccess(session, params.provider);
    }
  } else if (eventType === 'subscribe.updated') {
    await handleSubscriptionUpdated(session, params.provider);
  } else if (eventType === 'subscribe.canceled') {
    await handleSubscriptionCanceled(session, params.provider);
  }

  return event;
}

// --- Checkout Success: update order + create subscription + grant credits ---

async function handleCheckoutSuccess(session: any, provider: string) {
  // Different providers expose the session identifier under different keys.
  // We try the common shapes; for Alipay the natural key is out_trade_no
  // (which equals our orderNo and the value we stored in paymentSessionId).
  const result = session.paymentResult || {};
  const sessionId: string =
    result.id ||
    result.object?.id ||
    result.out_trade_no ||
    result.outTradeNo ||
    '';
  if (!sessionId) return;

  // Find order by session ID
  const [existingOrder] = await db()
    .select()
    .from(order)
    .where(and(eq(order.paymentSessionId, sessionId), isNull(order.deletedAt)))
    .limit(1);

  if (!existingOrder) return;
  await settleCheckoutOrder(existingOrder, session, provider);
}

/**
 * Apply a checkout outcome to an order read moments earlier. The read can be
 * stale — a concurrent webhook or callback may have settled the order since —
 * so this re-checks atomically instead of trusting `existingOrder.status`.
 * Exported for tests that replay that race.
 */
export async function settleCheckoutOrder(
  existingOrder: typeof order.$inferSelect,
  session: any,
  provider: string
) {
  // Fast path only; the conditional update below is the real guard.
  if (
    existingOrder.status !== OrderStatus.CREATED &&
    existingOrder.status !== OrderStatus.PENDING
  )
    return;

  const paymentInfo = session.paymentInfo;
  const subscriptionInfo = session.subscriptionInfo;

  if (session.paymentStatus === PaymentStatus.SUCCESS) {
    // CNY providers charge exactly the order amount (no coupons or tax on
    // their side), so any mismatch means the notification belongs to some
    // other trade — refuse to settle rather than grant on the wrong payment.
    if (
      (provider === 'alipay' || provider === 'wechat') &&
      paymentInfo?.amount !== existingOrder.amount
    ) {
      throw new Error(
        `Paid amount ${paymentInfo?.amount} does not match order ${existingOrder.orderNo} amount ${existingOrder.amount}`
      );
    }

    // Prepare order update
    const orderUpdate: Record<string, any> = {
      status: OrderStatus.PAID,
      paymentResult: JSON.stringify(session.paymentResult),
      paymentAmount: paymentInfo?.paymentAmount || null,
      paymentCurrency: paymentInfo?.paymentCurrency || null,
      paymentEmail: paymentInfo?.paymentEmail || null,
      paidAt: paymentInfo?.paidAt || new Date(),
      transactionId: paymentInfo?.transactionId || null,
      invoiceId: paymentInfo?.invoiceId || null,
      invoiceUrl: paymentInfo?.invoiceUrl || null,
      paymentUserName: paymentInfo?.paymentUserName || null,
      paymentUserId: paymentInfo?.paymentUserId || null,
      discountCode: paymentInfo?.discountCode || null,
      discountAmount: paymentInfo?.discountAmount || null,
    };

    // The webhook and the synchronous return (callback) both land here, often
    // at the same moment, so the status check above is only a fast path. The
    // guard re-checks inside the atomic write: exactly one caller moves the
    // order out of created/pending, and only that caller's grants commit —
    // all of it or none (D1 included; see core/db/atomic).
    const subscriptionNo =
      subscriptionInfo && session.subscriptionId ? getSnowId() : undefined;
    if (subscriptionNo) {
      orderUpdate.subscriptionNo = subscriptionNo;
      orderUpdate.subscriptionId = session.subscriptionId;
      orderUpdate.subscriptionResult = JSON.stringify(
        session.subscriptionResult
      );
    }

    const newSub: any = subscriptionNo && {
      id: getUuid(),
      subscriptionNo,
      userId: existingOrder.userId,
      userEmail: existingOrder.userEmail || existingOrder.paymentEmail || '',
      status: subscriptionInfo.status || SubscriptionStatus.ACTIVE,
      paymentProvider: provider,
      subscriptionId: session.subscriptionId,
      subscriptionResult: JSON.stringify(session.subscriptionResult),
      productId: existingOrder.productId,
      description: subscriptionInfo.description || 'Subscription Created',
      amount: subscriptionInfo.amount,
      currency: subscriptionInfo.currency,
      interval: subscriptionInfo.interval,
      intervalCount: subscriptionInfo.intervalCount,
      trialPeriodDays: subscriptionInfo.trialPeriodDays,
      currentPeriodStart: subscriptionInfo.currentPeriodStart,
      currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
      billingUrl: subscriptionInfo.billingUrl,
      planName: existingOrder.planName || existingOrder.productName,
      productName: existingOrder.productName,
      creditsAmount: existingOrder.creditsAmount,
      creditsValidDays: existingOrder.creditsValidDays,
      paymentProductId: existingOrder.paymentProductId,
      paymentUserId: paymentInfo?.paymentUserId,
    };

    const credits = existingOrder.creditsAmount || 0;
    const newCredit: any = credits > 0 && {
      id: getUuid(),
      userId: existingOrder.userId,
      userEmail: existingOrder.userEmail || '',
      orderNo: existingOrder.orderNo,
      subscriptionNo: subscriptionNo || '',
      // One grant per order, enforced by the unique transaction_no.
      transactionNo: `grant_${existingOrder.orderNo}`,
      transactionType: 'grant',
      transactionScene:
        existingOrder.paymentType === 'subscription'
          ? 'subscription'
          : 'payment',
      credits,
      remainingCredits: credits,
      description: 'Grant credit',
      expiresAt: calculateCreditExpirationTime({
        creditsValidDays: existingOrder.creditsValidDays || 0,
        currentPeriodEnd: subscriptionInfo?.currentPeriodEnd,
      }),
      status: 'active',
    };

    // Guest post orders submit their draft for review in the same write.
    const guestPost = planGuestPostFulfillment(existingOrder);

    let claimed = false;
    try {
      await atomic((q) => [
        // 1. Claim: only an unpaid order can be settled.
        guard({
          table: order,
          column: 'userId',
          where: eq(order.id, existingOrder.id),
          // Unpaid, never paid before, and nothing granted for it yet: the
          // status alone isn't enough if anything ever moves a paid order back.
          require: and(
            inArray(order.status, [OrderStatus.CREATED, OrderStatus.PENDING]),
            isNull(order.paidAt),
            sql`not exists (select 1 from ${credit} where ${credit.orderNo} = ${existingOrder.orderNo} and ${credit.transactionType} = 'grant')`
          )!,
          message: 'Order already settled',
        }),
        q.update(order).set(orderUpdate).where(eq(order.id, existingOrder.id)),
        // 2. Subscription, 3. credits.
        newSub && q.insert(subscription).values(newSub),
        newCredit && q.insert(credit).values(newCredit),
        // 4. Guest post: the paid draft enters review.
        ...(guestPost ? guestPost.steps(q) : []),
      ]);
      claimed = true;
    } catch (error) {
      if (!(error instanceof AtomicGuardError)) throw error;
      // another request already handled it
    }

    // Outside the transaction: only announce orders that actually committed,
    // and only from the request that claimed them.
    if (claimed) {
      await notifyPaymentSuccess(existingOrder.orderNo);
      if (guestPost) await notifyGuestPostSubmitted(guestPost.guestPostId);
    }
  } else if (
    session.paymentStatus === PaymentStatus.FAILED ||
    session.paymentStatus === PaymentStatus.CANCELED
  ) {
    await db()
      .update(order)
      .set({
        status: OrderStatus.FAILED,
        paymentResult: JSON.stringify(session.paymentResult),
      })
      .where(
        and(
          eq(order.id, existingOrder.id),
          inArray(order.status, [OrderStatus.CREATED, OrderStatus.PENDING])
        )
      );
  }
}

// --- Subscription Renewal ---

export async function handleSubscriptionRenewal(
  session: any,
  provider: string
) {
  if (!session.subscriptionId || !session.subscriptionInfo) return;

  const existingSub = await findByProviderSubscriptionId({
    provider,
    subscriptionId: session.subscriptionId,
  });
  if (!existingSub || !existingSub.amount || !existingSub.currency) return;

  const subscriptionInfo = session.subscriptionInfo;
  if (
    !subscriptionInfo.currentPeriodStart ||
    !subscriptionInfo.currentPeriodEnd
  )
    return;

  if (session.paymentStatus !== PaymentStatus.SUCCESS) return;

  const paymentInfo = session.paymentInfo;

  // Idempotency: drop duplicate renewals for the same provider transaction.
  if (paymentInfo?.transactionId) {
    const [dup] = await db()
      .select({ id: order.id })
      .from(order)
      .where(
        and(
          eq(order.transactionId, paymentInfo.transactionId),
          eq(order.paymentProvider, provider)
        )
      )
      .limit(1);
    if (dup) return;
  }

  // One renewal per subscription period: the order number is derived from the
  // period, so its unique key is the claim. Never infer "already renewed" from
  // the stored period — `subscribe.updated` for the same renewal can arrive
  // first and advance it before the payment does.
  const renewalOrderNo = `${existingSub.subscriptionNo}-${new Date(
    subscriptionInfo.currentPeriodStart
  ).getTime()}`;

  const credits = existingSub.creditsAmount || 0;
  const newCredit: any = credits > 0 && {
    id: getUuid(),
    userId: existingSub.userId,
    userEmail: existingSub.userEmail || '',
    orderNo: renewalOrderNo,
    subscriptionNo: existingSub.subscriptionNo,
    transactionNo: `grant_${renewalOrderNo}`,
    transactionType: 'grant',
    transactionScene: 'renewal',
    credits,
    remainingCredits: credits,
    description: 'Grant credit',
    expiresAt: calculateCreditExpirationTime({
      creditsValidDays: existingSub.creditsValidDays || 0,
      currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
    }),
    status: 'active',
  };

  let claimed = false;
  try {
    await atomic((q) => [
      // 1. Claim the renewal: no order for this period yet. Concurrent
      //    callers that both pass collide on the unique orderNo instead; the
      //    loser throws, the provider retries, and the retry stops here.
      guard({
        table: order,
        column: 'userId',
        where: eq(order.orderNo, renewalOrderNo),
        require: sql`1 = 0`,
        message: 'Period already renewed',
      }),
      // 2. Advance the period (never backwards: events arrive out of order).
      q
        .update(subscription)
        .set({
          currentPeriodStart: subscriptionInfo.currentPeriodStart,
          currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
        })
        .where(
          and(
            eq(subscription.subscriptionNo, existingSub.subscriptionNo),
            or(
              isNull(subscription.currentPeriodStart),
              lt(
                subscription.currentPeriodStart,
                subscriptionInfo.currentPeriodStart
              )
            )
          )
        ),
      // 3. Renewal order, 4. renewal credits.
      q.insert(order).values({
        id: getUuid(),
        orderNo: renewalOrderNo,
        userId: existingSub.userId,
        userEmail: existingSub.userEmail || '',
        status: OrderStatus.PAID,
        amount: existingSub.amount,
        currency: existingSub.currency,
        productId: existingSub.productId || '',
        paymentType: 'renew',
        paymentInterval: existingSub.interval || '',
        paymentProvider: provider,
        checkoutInfo: '',
        description: 'Subscription Renewal',
        productName: existingSub.productName || '',
        planName: existingSub.planName || '',
        creditsAmount: existingSub.creditsAmount,
        creditsValidDays: existingSub.creditsValidDays,
        paymentProductId: existingSub.paymentProductId || '',
        paymentResult: JSON.stringify(session.paymentResult),
        paymentAmount: paymentInfo?.paymentAmount,
        paymentCurrency: paymentInfo?.paymentCurrency,
        paymentEmail: paymentInfo?.paymentEmail,
        paidAt: paymentInfo?.paidAt || new Date(),
        invoiceId: paymentInfo?.invoiceId,
        invoiceUrl: paymentInfo?.invoiceUrl,
        subscriptionNo: existingSub.subscriptionNo,
        subscriptionId: session.subscriptionId,
        transactionId: paymentInfo?.transactionId,
        paymentUserName: paymentInfo?.paymentUserName,
        paymentUserId: paymentInfo?.paymentUserId,
      }),
      newCredit && q.insert(credit).values(newCredit),
    ]);
    claimed = true;
  } catch (error) {
    if (!(error instanceof AtomicGuardError)) throw error;
    // this period was already renewed
  }

  if (claimed) await notifyPaymentSuccess(renewalOrderNo);
}

// --- Subscription Updated ---

export async function handleSubscriptionUpdated(
  session: any,
  provider: string
) {
  if (!session.subscriptionId || !session.subscriptionInfo) return;

  const existingSub = await findByProviderSubscriptionId({
    provider,
    subscriptionId: session.subscriptionId,
  });
  if (!existingSub) return;

  const info = session.subscriptionInfo;
  await updateBySubscriptionNo(existingSub.subscriptionNo, {
    status: info.status,
    canceledAt: info.canceledAt || null,
    canceledEndAt: info.canceledEndAt || null,
    canceledReason: info.canceledReason || '',
    canceledReasonType: info.canceledReasonType || '',
  });
  // The period only moves forward, so a late or reordered event can't rewind it.
  if (info.currentPeriodStart && info.currentPeriodEnd) {
    await db()
      .update(subscription)
      .set({
        currentPeriodStart: info.currentPeriodStart,
        currentPeriodEnd: info.currentPeriodEnd,
      })
      .where(
        and(
          eq(subscription.subscriptionNo, existingSub.subscriptionNo),
          or(
            isNull(subscription.currentPeriodStart),
            lt(subscription.currentPeriodStart, info.currentPeriodStart)
          )
        )
      );
  }
}

// --- Subscription Canceled ---

async function handleSubscriptionCanceled(session: any, provider: string) {
  if (!session.subscriptionId || !session.subscriptionInfo) return;

  const existingSub = await findByProviderSubscriptionId({
    provider,
    subscriptionId: session.subscriptionId,
  });
  if (!existingSub) return;

  const info = session.subscriptionInfo;
  await updateBySubscriptionNo(existingSub.subscriptionNo, {
    status: SubscriptionStatus.CANCELED,
    canceledAt: info.canceledAt,
    canceledEndAt: info.canceledEndAt,
    canceledReason: info.canceledReason,
    canceledReasonType: info.canceledReasonType,
  });
}

// --- Cancel subscription (user-initiated) ---

export async function cancelUserSubscription(params: {
  userId: string;
  subscriptionNo: string;
}) {
  const { userId, subscriptionNo } = params;

  const sub = await findBySubscriptionNo(subscriptionNo);
  if (!sub) throw new Error('Subscription not found');
  if (sub.userId !== userId) throw new Error('Forbidden');

  if (
    sub.status === SubscriptionStatus.CANCELED ||
    sub.status === SubscriptionStatus.EXPIRED
  ) {
    return sub;
  }

  const pm = await getPaymentManager();
  const provider = pm.getProvider(sub.paymentProvider);
  if (!provider || !provider.cancelSubscription) {
    throw new Error('Cancellation not supported for this provider');
  }

  const session = await provider.cancelSubscription({
    subscriptionId: sub.subscriptionId,
  });

  const info = session.subscriptionInfo;
  const updated = await updateBySubscriptionNo(subscriptionNo, {
    status: info?.status || SubscriptionStatus.CANCELED,
    canceledAt: info?.canceledAt || new Date(),
    canceledEndAt: info?.canceledEndAt || null,
    canceledReason: info?.canceledReason || 'Canceled by user',
    canceledReasonType: info?.canceledReasonType || 'user_request',
  });

  return updated;
}

// --- Refund (admin-initiated) ---

export async function refundOrder(params: {
  orderNo: string;
  operatorId: string;
  reason?: string;
  deductCredits?: number; // defaults to the credits this order granted
  cancelSubscription?: boolean;
}) {
  const { orderNo, operatorId, reason } = params;

  const [existingOrder] = await db()
    .select()
    .from(order)
    .where(and(eq(order.orderNo, orderNo), isNull(order.deletedAt)))
    .limit(1);
  if (!existingOrder) throw new Error('Order not found');

  const staleBefore = new Date(Date.now() - REFUND_STALE_MS);
  if (
    existingOrder.status !== OrderStatus.PAID &&
    !(
      existingOrder.status === OrderStatus.REFUNDING &&
      existingOrder.updatedAt < staleBefore
    )
  ) {
    throw new Error(
      existingOrder.status === OrderStatus.REFUNDING
        ? 'A refund for this order is already in progress'
        : `Only paid orders can be refunded (status: ${existingOrder.status})`
    );
  }

  // Resolve the provider BEFORE claiming. getProvider() falls back to the
  // default provider, so check the name — never refund through the wrong one.
  const paidAmount = existingOrder.paymentAmount ?? existingOrder.amount;
  const pm = await getPaymentManager();
  const provider = pm.getProvider(existingOrder.paymentProvider);
  if (paidAmount > 0) {
    if (
      !provider ||
      provider.name !== existingOrder.paymentProvider ||
      !provider.refundPayment
    ) {
      throw new Error(
        `Refund is not supported for provider '${existingOrder.paymentProvider}' (not configured or no refund API)`
      );
    }
  }

  // 1. Claim the order so a double click can't refund twice. The token
  //    check works on every dialect without relying on affected-row counts.
  const claim = JSON.stringify({ claim: getUuid() });
  await db()
    .update(order)
    .set({ status: OrderStatus.REFUNDING, refundResult: claim })
    .where(
      and(
        eq(order.id, existingOrder.id),
        or(
          eq(order.status, OrderStatus.PAID),
          and(
            eq(order.status, OrderStatus.REFUNDING),
            lt(order.updatedAt, staleBefore)
          )
        )
      )
    );
  const [claimed] = await db()
    .select({ refundResult: order.refundResult })
    .from(order)
    .where(eq(order.id, existingOrder.id))
    .limit(1);
  if (claimed?.refundResult !== claim) {
    throw new Error('A refund for this order is already in progress');
  }

  // 2. Refund at the provider. On failure, release the claim.
  let refund: PaymentRefund | null = null;
  if (paidAmount > 0 && provider?.refundPayment) {
    try {
      refund = await provider.refundPayment({
        orderNo: existingOrder.orderNo,
        sessionId: existingOrder.paymentSessionId || undefined,
        transactionId: existingOrder.transactionId || undefined,
        invoiceId: existingOrder.invoiceId || undefined,
        paymentType: existingOrder.paymentType || undefined,
        amount: existingOrder.amount,
        currency: existingOrder.currency,
        reason,
      });
    } catch (error) {
      await db()
        .update(order)
        .set({ status: OrderStatus.PAID, refundResult: null })
        .where(
          and(eq(order.id, existingOrder.id), eq(order.refundResult, claim))
        );
      throw error;
    }
  }

  // 3. Atomically deduct credits + mark the order refunded.
  const creditsToDeduct = Math.max(
    0,
    Math.floor(params.deductCredits ?? existingOrder.creditsAmount ?? 0)
  );
  const refundAmount = refund?.amount ?? paidAmount;
  let creditsDeducted = 0;
  try {
    const deduction = await planDeductForRefund({
      userId: existingOrder.userId,
      userEmail: existingOrder.userEmail || '',
      orderNo: existingOrder.orderNo,
      credits: creditsToDeduct,
      description: `Refund ${existingOrder.orderNo}`,
    });
    await atomic((q) => [
      guard({
        table: order,
        column: 'userId',
        where: eq(order.id, existingOrder.id),
        require: and(
          eq(order.status, OrderStatus.REFUNDING),
          eq(order.refundResult, claim)
        )!,
        message: 'Order refund claim lost',
      }),
      ...deduction.steps(q),
      // A refunded guest post order rejects (or takes down) its submission.
      ...planGuestPostRefund(existingOrder.orderNo)(q),
      q
        .update(order)
        .set({
          status: OrderStatus.REFUNDED,
          refundAmount,
          refundedAt: new Date(),
          refundResult: JSON.stringify({
            refundId: refund?.refundId || null,
            status: refund?.status || 'succeeded',
            reason: reason || '',
            operatorId,
            creditsDeducted: deduction.deducted,
            providerResult: refund?.refundResult ?? null,
          }),
        })
        .where(eq(order.id, existingOrder.id)),
    ]);
    creditsDeducted = deduction.deducted;
  } catch (error: any) {
    // The provider has already refunded; leave the order in REFUNDING so it
    // can be retried (idempotently) instead of looking like a paid order.
    throw new Error(
      `Refund was issued at the provider but saving it failed: ${error?.message || error}. Retry in a few minutes.`
    );
  }

  // 4. Optionally cancel the subscription — best effort, after the refund
  //    is recorded, so a cancel failure never hides a completed refund.
  let subscriptionCanceled = false;
  let subscriptionError: string | undefined;
  if (params.cancelSubscription && existingOrder.subscriptionNo) {
    try {
      const sub = await findBySubscriptionNo(existingOrder.subscriptionNo);
      if (
        sub &&
        sub.status !== SubscriptionStatus.CANCELED &&
        sub.status !== SubscriptionStatus.EXPIRED
      ) {
        const subProvider = pm.getProvider(sub.paymentProvider);
        if (
          !subProvider ||
          subProvider.name !== sub.paymentProvider ||
          !subProvider.cancelSubscription
        ) {
          throw new Error('Cancellation not supported for this provider');
        }
        const session = await subProvider.cancelSubscription({
          subscriptionId: sub.subscriptionId,
        });
        const info = session.subscriptionInfo;
        await updateBySubscriptionNo(sub.subscriptionNo, {
          status: info?.status || SubscriptionStatus.CANCELED,
          canceledAt: info?.canceledAt || new Date(),
          canceledEndAt: info?.canceledEndAt || null,
          canceledReason: reason || 'Refunded by admin',
          canceledReasonType: 'refund',
        });
      }
      subscriptionCanceled = true;
    } catch (error: any) {
      subscriptionError = error?.message || String(error);
    }
  }

  return {
    orderNo: existingOrder.orderNo,
    refundId: refund?.refundId || null,
    refundStatus: refund?.status || 'succeeded',
    refundAmount,
    creditsDeducted,
    creditsRequested: creditsToDeduct,
    subscriptionCanceled,
    subscriptionError,
  };
}

// --- Query helpers ---

export async function getUserOrders(userId: string) {
  return db()
    .select()
    .from(order)
    .where(and(eq(order.userId, userId), isNull(order.deletedAt)))
    .orderBy(desc(order.createdAt));
}
