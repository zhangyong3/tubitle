import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'tubitle-waffo-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${dir}/test.db`,
  AUTH_SECRET: 'test-only-not-a-real-secret',
  NODE_ENV: 'test',
});
execFileSync(
  process.execPath,
  [
    'node_modules/drizzle-kit/bin.cjs',
    'push',
    '--dialect=sqlite',
    '--schema=./src/config/db/schema.sqlite.ts',
    `--url=${process.env.DATABASE_URL}`,
    '--force',
  ],
  { stdio: 'pipe' }
);
const { db } = await import('../src/core/db');
const { user, order, subscription } = await import('../src/config/db/schema');
const { WaffoProvider, waffoConfigured } =
  await import('../src/core/payment/waffo');
const { settleCheckoutOrder } = await import('../src/modules/payment/service');
const { getPricingProduct, PRO_MONTHLY_PRODUCT_ID } =
  await import('../src/config/pricing');
const { activeProSubscription, planFor } =
  await import('../src/lib/learning-plan');
const { isSecretConfigKey, filterPublicConfigs, saveConfigs, getAdminConfigs } =
  await import('../src/modules/config/service');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const configs = {
  waffo_enabled: 'true',
  waffo_environment: 'test',
  waffo_merchant_id: 'MER_0000000000000000000000',
  waffo_store_id: 'store',
  waffo_pro_product_id: 'product',
  waffo_private_key: keys.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString(),
  waffo_webhook_public_key: keys.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString(),
};
const provider = new WaffoProvider(configs);
const remote = {
  id: 'remote-order',
  status: 'active',
  billingPeriod: 'monthly',
  buyerEmail: 'member@example.test',
  currentPeriodStart: new Date(Date.now() - 86400000).toISOString(),
  currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
  subscriptionProduct: { id: 'product' },
  priceSnapshot: {
    currency: 'USD',
    regularPhase: { subtotal: '3.50', total: '3.50' },
  },
  payments: [
    {
      id: 'payment',
      status: 'succeeded',
      createdAt: new Date().toISOString(),
      snapshotAmountDetails: { total: '3.50', currency: 'USD' },
    },
  ],
};
const client = (provider as any).client;
client.graphql.query = async () => ({ data: { subscriptionOrder: remote } });
await db()
  .insert(user)
  .values({ id: 'member', name: 'Member', email: 'member@example.test' });
await db()
  .insert(order)
  .values({
    id: 'local-order',
    orderNo: 'local-order',
    userId: 'member',
    status: 'created',
    amount: 350,
    currency: 'usd',
    productId: PRO_MONTHLY_PRODUCT_ID,
    paymentProvider: 'waffo',
    paymentSessionId: 'checkout',
    checkoutInfo: '{}',
    paymentType: 'subscription',
    planName: 'Pro',
  });
after(async () => {
  await rm(dir, { recursive: true, force: true });
});
function request(
  overrides: Record<string, unknown> = {},
  badSignature = false
) {
  const payload = JSON.stringify({
    id: 'evt',
    eventId: 'evt',
    eventType: 'subscription.activated',
    storeId: 'store',
    mode: 'test',
    timestamp: new Date().toISOString(),
    data: {
      orderId: remote.id,
      orderMerchantExternalId: 'local-order',
      merchantProvidedBuyerIdentity: 'member',
    },
    ...overrides,
  });
  const timestamp = Date.now().toString();
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}.${payload}`),
    keys.privateKey
  ).toString('base64');
  return new Request('https://app.example.test/api/payment/notify/waffo', {
    method: 'POST',
    body: payload,
    headers: {
      'X-Waffo-Signature': `t=${timestamp},v1=${badSignature ? 'invalid' : signature}`,
    },
  });
}
test('price is USD 350 cents monthly; disabled or incomplete Waffo cannot sell', () => {
  const product = getPricingProduct(PRO_MONTHLY_PRODUCT_ID)!;
  assert.equal(product.priceInCents, 350);
  assert.equal(product.currency, 'usd');
  assert.equal(product.plan?.interval, 'month');
  assert.equal(waffoConfigured(configs), true);
  assert.equal(waffoConfigured({ ...configs, waffo_enabled: 'false' }), false);
  assert.equal(waffoConfigured({ ...configs, waffo_private_key: '' }), false);
});
test('private key is secret, masked in admin and excluded from public config', async () => {
  assert.equal(isSecretConfigKey('waffo_private_key'), true);
  await saveConfigs({ waffo_private_key: configs.waffo_private_key });
  assert.notEqual(
    (await getAdminConfigs()).waffo_private_key,
    configs.waffo_private_key
  );
  assert.deepEqual(
    filterPublicConfigs(configs, Object.keys(configs)).waffo_private_key,
    undefined
  );
});
test('rejects bad signature, wrong store, wrong environment and wrong member', async () => {
  await assert.rejects(provider.getPaymentEvent({ req: request({}, true) }));
  await assert.rejects(
    provider.getPaymentEvent({ req: request({ storeId: 'other' }) })
  );
  await assert.rejects(
    provider.getPaymentEvent({ req: request({ mode: 'prod' }) })
  );
  await assert.rejects(
    provider.getPaymentEvent({
      req: request({
        data: {
          orderId: remote.id,
          orderMerchantExternalId: 'local-order',
          merchantProvidedBuyerIdentity: 'other',
        },
      }),
    })
  );
});
test('verified activation settles once under duplicate delivery and grants Pro', async () => {
  const event = await provider.getPaymentEvent({ req: request() });
  assert.equal(event.eventType, 'checkout.success');
  const [local] = await db().select().from(order);
  await Promise.all([
    settleCheckoutOrder(local, event.paymentSession, 'waffo'),
    settleCheckoutOrder(local, event.paymentSession, 'waffo'),
  ]);
  assert.equal((await db().select().from(subscription)).length, 1);
  assert.equal(await planFor('member'), 'pro');
  assert.equal(
    (await activeProSubscription('member'))?.productId,
    PRO_MONTHLY_PRODUCT_ID
  );
});
test('reads latest remote cancellation even for delayed activation', async () => {
  remote.status = 'canceled';
  const event = await provider.getPaymentEvent({ req: request() });
  assert.equal(event.eventType, 'subscribe.canceled');
  assert.equal(event.paymentSession?.subscriptionInfo?.status, 'canceled');
});
test('browser return cannot activate membership', async () => {
  assert.equal(
    (await provider.getPaymentSession()).paymentStatus,
    'processing'
  );
});

test('checkout binds member identity and forces USD 3.50 without trial', async () => {
  const originalQuery = client.graphql.query;
  const originalCreate = client.checkout.authenticated.create;
  let params: any;
  client.graphql.query = async () => ({
    data: {
      subscriptionProducts: [
        {
          id: 'product',
          billingPeriod: 'monthly',
          prices: [
            {
              currency: 'USD',
              priceInfo: { amount: '3.50', taxCategory: 'saas' },
            },
          ],
        },
      ],
    },
  });
  client.checkout.authenticated.create = async (input: any) => {
    params = input;
    return {
      sessionId: 'session',
      checkoutUrl: 'https://pancake.waffo.ai/checkout#token=short-lived',
    };
  };
  try {
    const result = await provider.createPayment({
      order: {
        type: 'subscription' as any,
        productId: PRO_MONTHLY_PRODUCT_ID,
        orderNo: 'new-order',
        price: { amount: 350, currency: 'usd' },
        customer: {
          email: 'member@example.test',
          metadata: { userId: 'member' },
        },
      },
    });
    assert.equal(params.buyerIdentity, 'member');
    assert.equal(params.orderMerchantExternalId, 'new-order');
    assert.deepEqual(params.priceSnapshot, {
      amount: '3.50',
      taxCategory: 'saas',
    });
    assert.equal(params.withTrial, false);
    assert.equal(params.allowPromotionCodes, false);
    assert.equal(
      JSON.stringify(result.checkoutResult).includes('token='),
      false
    );
    await assert.rejects(
      provider.createPayment({
        order: {
          type: 'subscription' as any,
          productId: PRO_MONTHLY_PRODUCT_ID,
          price: { amount: 1, currency: 'usd' },
        },
      })
    );
  } finally {
    client.graphql.query = originalQuery;
    client.checkout.authenticated.create = originalCreate;
  }
});
test('pending cancellation retains paid access; expired and canceled members become Free', async () => {
  const { eq } = await import('drizzle-orm');
  const sub = (await db().select().from(subscription))[0];
  await db()
    .update(subscription)
    .set({ status: 'pending_cancel' })
    .where(eq(subscription.id, sub.id));
  assert.equal(await planFor('member'), 'pro');
  await db()
    .update(subscription)
    .set({ currentPeriodEnd: new Date(Date.now() - 1000) })
    .where(eq(subscription.id, sub.id));
  assert.equal(await planFor('member'), 'free');
  await db()
    .update(subscription)
    .set({
      currentPeriodEnd: new Date(Date.now() + 86400000),
      status: 'canceled',
    })
    .where(eq(subscription.id, sub.id));
  assert.equal(await planFor('member'), 'free');
});
