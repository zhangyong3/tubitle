import {
  verifyWebhook,
  WaffoPancake,
  type TaxCategory,
} from '@waffo/pancake-ts';
import { and, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { order as orders } from '@/config/db/schema';
import { PRO_MONTHLY_PRODUCT_ID } from '@/config/pricing';

import {
  PaymentEventType,
  PaymentInterval,
  PaymentStatus,
  PaymentType,
  SubscriptionCycleType,
  SubscriptionStatus,
  WebhookIgnoredError,
  type PaymentOrder,
  type PaymentProvider,
  type PaymentSession,
} from './types';

export function waffoCredentialsConfigured(c: Record<string, string>) {
  return (
    ['test', 'prod'].includes(c.waffo_environment) &&
    !!c.waffo_merchant_id &&
    !!c.waffo_private_key &&
    !!c.waffo_store_id &&
    !!c.waffo_pro_product_id
  );
}

export function waffoConfigured(c: Record<string, string>) {
  return c.waffo_enabled === 'true' && waffoCredentialsConfigured(c);
}

type RemoteOrder = {
  id: string;
  status: string;
  billingPeriod: string;
  buyerEmail: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  canceledAt?: string;
  subscriptionProduct: { id: string };
  priceSnapshot: {
    currency: string;
    regularPhase: { subtotal: string; total: string };
  };
  payments: {
    id: string;
    status: string;
    refundStatus?: string;
    createdAt: string;
    snapshotAmountDetails: { currency: string; total: string };
  }[];
};

export class WaffoProvider implements PaymentProvider {
  readonly name = 'waffo';
  private client: WaffoPancake;
  constructor(public configs: Record<string, string>) {
    this.client = new WaffoPancake({
      merchantId: configs.waffo_merchant_id,
      privateKey: configs.waffo_private_key,
      environment: configs.waffo_environment as 'test' | 'prod',
    });
  }
  async checkProduct() {
    const products = await this.client.graphql.query<{
      subscriptionProducts: {
        id: string;
        billingPeriod: string;
        prices: {
          currency: string;
          priceInfo: { amount: string; taxCategory: TaxCategory };
        }[];
      }[];
    }>({
      query: `query ($storeId: String!) { subscriptionProducts(storeId: $storeId) {
      id billingPeriod prices { currency priceInfo { amount taxCategory } } } }`,
      variables: { storeId: this.configs.waffo_store_id },
    });
    const product = products.data?.subscriptionProducts.find(
      (p) => p.id === this.configs.waffo_pro_product_id
    );
    if (products.errors?.length) throw new Error('Waffo product query failed');
    if (
      !product ||
      product.billingPeriod !== 'monthly' ||
      !product.prices.some(
        (p) =>
          p.currency.toUpperCase() === 'USD' &&
          Number(p.priceInfo.amount) === 3.5
      )
    ) {
      throw new Error(
        'Configure a Waffo USD 3.50 monthly subscription product'
      );
    }
    return product;
  }
  async createPayment({ order }: { order: PaymentOrder }) {
    if (
      order.productId !== PRO_MONTHLY_PRODUCT_ID ||
      order.type !== PaymentType.SUBSCRIPTION ||
      order.price?.amount !== 350 ||
      order.price.currency.toLowerCase() !== 'usd'
    ) {
      throw new Error('Waffo supports only Tubitle Pro at USD 3.50/month');
    }
    const product = await this.checkProduct();
    const identity = order.customer?.metadata?.userId;
    if (!identity || !order.orderNo) throw new Error('Missing member identity');
    const result = await this.client.checkout.authenticated.create(
      {
        productId: product.id,
        currency: 'USD',
        buyerIdentity: identity,
        priceSnapshot: {
          amount: '3.50',
          taxCategory: product.prices.find(
            (p) => p.currency.toUpperCase() === 'USD'
          )!.priceInfo.taxCategory,
        },
        buyerEmail: order.customer?.email,
        withTrial: false,
        allowPromotionCodes: false,
        successUrl: order.successUrl,
        orderMerchantExternalId: order.orderNo,
        metadata: { order_no: order.orderNo },
      },
      { idempotencyKey: order.orderNo }
    );
    // The URL contains a short-lived customer token; persistence strips it in payment/service.
    return {
      provider: this.name,
      checkoutParams: { productId: product.id },
      checkoutInfo: {
        sessionId: result.sessionId,
        checkoutUrl: result.checkoutUrl,
      },
      checkoutResult: { sessionId: result.sessionId },
      metadata: { order_no: order.orderNo },
    };
  }
  async getPaymentSession(): Promise<PaymentSession> {
    // A return URL is not proof of payment. Signed webhooks settle this provider.
    return { provider: this.name, paymentStatus: PaymentStatus.PROCESSING };
  }
  private async snapshot(id: string): Promise<RemoteOrder> {
    const response = await this.client.graphql.query<{
      subscriptionOrder: RemoteOrder;
    }>({
      query: `query ($id: String!) { subscriptionOrder(id: $id) {
        id status buyerEmail billingPeriod currentPeriodStart currentPeriodEnd canceledAt
        subscriptionProduct { id } priceSnapshot { currency regularPhase { subtotal total } }
        payments { id status refundStatus createdAt snapshotAmountDetails { currency total } }
      } }`,
      variables: { id },
    });
    if (response.errors?.length)
      throw new Error('Waffo subscription query failed');
    const remote = response.data?.subscriptionOrder;
    if (
      !remote ||
      remote.subscriptionProduct.id !== this.configs.waffo_pro_product_id ||
      remote.billingPeriod !== 'monthly' ||
      remote.priceSnapshot.currency.toUpperCase() !== 'USD'
    ) {
      throw new Error(
        'Waffo subscription does not match configured Pro product'
      );
    }
    return remote;
  }
  private session(remote: RemoteOrder): PaymentSession {
    const start = new Date(remote.currentPeriodStart),
      end = new Date(remote.currentPeriodEnd);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    )
      throw new Error('Invalid subscription period');
    const payment = remote.payments
      .filter((p) => p.status === 'succeeded')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const status =
      remote.status === 'canceling'
        ? SubscriptionStatus.PENDING_CANCEL
        : ['canceled', 'closed', 'expired'].includes(remote.status)
          ? SubscriptionStatus.CANCELED
          : remote.status === 'active'
            ? SubscriptionStatus.ACTIVE
            : SubscriptionStatus.PAUSED;
    return {
      provider: this.name,
      paymentStatus: payment ? PaymentStatus.SUCCESS : PaymentStatus.PROCESSING,
      paymentInfo: payment
        ? {
            transactionId: payment.id,
            paymentAmount: Math.round(
              Number(payment.snapshotAmountDetails.total) * 100
            ),
            paymentCurrency:
              payment.snapshotAmountDetails.currency.toLowerCase(),
            paymentEmail: remote.buyerEmail,
            paidAt: new Date(payment.createdAt),
            subscriptionCycleType: SubscriptionCycleType.RENEWAL,
          }
        : undefined,
      subscriptionId: remote.id,
      subscriptionInfo: {
        subscriptionId: remote.id,
        productId: PRO_MONTHLY_PRODUCT_ID,
        status,
        amount: 350,
        currency: 'usd',
        interval: PaymentInterval.MONTH,
        intervalCount: 1,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        canceledAt: remote.canceledAt ? new Date(remote.canceledAt) : undefined,
        canceledEndAt:
          status === SubscriptionStatus.PENDING_CANCEL ? end : undefined,
      },
      subscriptionResult: { id: remote.id, status: remote.status },
    };
  }
  async getPaymentEvent({ req }: { req: Request }) {
    const event = verifyWebhook(
      await req.text(),
      req.headers.get('X-Waffo-Signature'),
      {
        environment: this.configs.waffo_environment as 'test' | 'prod',
        ...(this.configs.waffo_webhook_public_key
          ? { publicKey: this.configs.waffo_webhook_public_key }
          : {}),
      }
    );
    if (
      event.storeId !== this.configs.waffo_store_id ||
      event.mode !== this.configs.waffo_environment
    )
      throw new Error('Wrong Waffo store or environment');
    const supported = [
      'subscription.activated',
      'subscription.renewed',
      'subscription.recovered',
      'subscription.canceling',
      'subscription.uncanceled',
      'subscription.canceled',
      'subscription.past_due',
    ];
    if (!supported.includes(event.eventType)) {
      if (event.eventType === 'refund.succeeded')
        throw new Error(
          'Waffo refund requires reconciliation in the merchant dashboard'
        );
      throw new WebhookIgnoredError(
        `Unhandled Waffo event: ${event.eventType}`
      );
    }
    const data = event.data;
    if (
      typeof data.orderMerchantExternalId !== 'string' ||
      typeof data.orderId !== 'string'
    )
      throw new Error('Missing Waffo order identity');
    const [local] = await db()
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.orderNo, data.orderMerchantExternalId),
          eq(orders.paymentProvider, this.name)
        )
      )
      .limit(1);
    if (!local || local.productId !== PRO_MONTHLY_PRODUCT_ID)
      throw new Error('Waffo order not found');
    const remote = await this.snapshot(data.orderId);
    if (data.merchantProvidedBuyerIdentity !== local.userId)
      throw new Error('Wrong Waffo member identity');
    if (local.subscriptionId && local.subscriptionId !== remote.id)
      throw new Error('Wrong Waffo subscription');
    const session = this.session(remote);
    session.paymentResult = { id: local.paymentSessionId };
    const initial = local.status === 'created' || local.status === 'pending';
    if (initial && !['active', 'canceling'].includes(remote.status))
      throw new Error('Waffo subscription is not paid and active');
    let eventType = initial
      ? PaymentEventType.CHECKOUT_SUCCESS
      : PaymentEventType.SUBSCRIBE_UPDATED;
    if (
      !initial &&
      ['subscription.renewed', 'subscription.recovered'].includes(
        event.eventType
      ) &&
      remote.status === 'active'
    )
      eventType = PaymentEventType.PAYMENT_SUCCESS;
    if (
      !initial &&
      session.subscriptionInfo?.status === SubscriptionStatus.CANCELED
    )
      eventType = PaymentEventType.SUBSCRIBE_CANCELED;
    return {
      eventType,
      eventResult: { eventId: event.eventId, eventType: event.eventType },
      paymentSession: session,
    };
  }
  async cancelSubscription({ subscriptionId }: { subscriptionId: string }) {
    await this.client.orders.cancelSubscription({ orderId: subscriptionId });
    return this.session(await this.snapshot(subscriptionId));
  }
}
