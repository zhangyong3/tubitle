import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';

// Isolated SQLite DB; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-guards-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-guards-test-secret-not-a-real-credential',
  NODE_ENV: 'test',
  VITE_APP_URL: 'http://localhost:3000',
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
  { stdio: 'pipe', env: process.env }
);
const { db } = await import('../src/core/db');
const schema = await import('../src/config/db/schema');
const { settleCheckoutOrder } = await import('../src/modules/payment/service');
const { assertEndpointSecretsResupplied } =
  await import('../src/modules/config/service');
const { enforceMinIntervalRateLimit } = await import('../src/lib/rate-limit');
const { PATCH: patchOrder } =
  await import('../src/server/admin/handlers/orders');
const { isValidEmbedSetting } = await import('../src/lib/embed-ids');

before(async () => {
  await db()
    .insert(schema.user)
    .values({ id: 'u1', name: 'A', email: 'a@example.test' });
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function createdOrder(orderNo: string, provider: string, amount: number) {
  await db().insert(schema.order).values({
    id: orderNo,
    orderNo,
    userId: 'u1',
    status: 'created',
    amount,
    currency: 'cny',
    paymentProvider: provider,
    paymentSessionId: orderNo,
    checkoutInfo: '{}',
    paymentType: 'one-time',
    creditsAmount: 100,
  });
  const [row] = await db()
    .select()
    .from(schema.order)
    .where(eq(schema.order.orderNo, orderNo));
  return row;
}
const success = (orderNo: string, amount: number) => ({
  paymentStatus: 'paid',
  paymentInfo: { amount, transactionId: `T-${orderNo}` },
  paymentResult: { out_trade_no: orderNo },
});

test('a CNY notification whose amount differs from the order is refused and grants nothing', async () => {
  const order = await createdOrder('ORD-MISMATCH', 'alipay', 9900);
  await assert.rejects(
    settleCheckoutOrder(order, success('ORD-MISMATCH', 1), 'alipay'),
    /does not match/
  );
  const [row] = await db()
    .select()
    .from(schema.order)
    .where(eq(schema.order.orderNo, 'ORD-MISMATCH'));
  assert.equal(row.status, 'created');
  const credits = await db()
    .select()
    .from(schema.credit)
    .where(eq(schema.credit.userId, 'u1'));
  assert.equal(credits.length, 0);
});

test('a matching CNY notification settles the order', async () => {
  const order = await createdOrder('ORD-MATCH', 'wechat', 9900);
  await settleCheckoutOrder(order, success('ORD-MATCH', 9900), 'wechat');
  const [row] = await db()
    .select()
    .from(schema.order)
    .where(eq(schema.order.orderNo, 'ORD-MATCH'));
  assert.equal(row.status, 'paid');
});

test('re-pointing an endpoint requires re-entering its saved secret', () => {
  const saved = {
    openai_base_url: 'https://api.openai.com/v1',
    openai_api_key: 'sk-saved',
  };
  assert.throws(
    () =>
      assertEndpointSecretsResupplied(
        { openai_base_url: 'https://evil.example' },
        saved
      ),
    /re-entering openai_api_key/
  );
  assert.throws(
    () =>
      assertEndpointSecretsResupplied(
        {
          openai_base_url: 'https://evil.example',
          openai_api_key: '••••••••aved',
        },
        saved
      ),
    /re-entering/
  );
  assert.doesNotThrow(() =>
    assertEndpointSecretsResupplied(
      { openai_base_url: 'https://evil.example', openai_api_key: 'sk-new' },
      saved
    )
  );
  assert.doesNotThrow(
    () =>
      assertEndpointSecretsResupplied(
        { openai_base_url: 'https://api.openai.com/v1/' },
        saved
      ),
    'unchanged (trailing slash) is fine'
  );
  assert.doesNotThrow(
    () =>
      assertEndpointSecretsResupplied(
        { openai_base_url: 'https://other.example' },
        { openai_base_url: '' }
      ),
    'no saved secret to leak'
  );
  assert.throws(
    () =>
      assertEndpointSecretsResupplied(
        { telegram_api_base: 'https://evil.example' },
        { telegram_bot_token: '123:abc' }
      ),
    /telegram_bot_token/
  );
  assert.throws(
    () =>
      assertEndpointSecretsResupplied(
        { notify_webhook_url: 'https://evil.example/hook' },
        {
          notify_webhook_url: 'https://ok.example/hook',
          notify_webhook_token: 't',
        }
      ),
    /notify_webhook_token/
  );
});

test('rate limiting ignores cookies and keys authenticated callers by user', () => {
  const req = (cookie: string, ip = '203.0.113.9') =>
    new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { cookie, 'x-forwarded-for': ip },
    });
  assert.equal(
    enforceMinIntervalRateLimit(req('a=1'), {
      intervalMs: 60_000,
      keyPrefix: 't1',
    }),
    null
  );
  assert.equal(
    enforceMinIntervalRateLimit(req('a=2'), {
      intervalMs: 60_000,
      keyPrefix: 't1',
    })?.status,
    429,
    'a new cookie is not a new bucket'
  );
  assert.equal(
    enforceMinIntervalRateLimit(req('', '198.51.100.1'), {
      intervalMs: 60_000,
      keyPrefix: 't2',
      extraKey: 'u1',
    }),
    null
  );
  assert.equal(
    enforceMinIntervalRateLimit(req('', '198.51.100.2'), {
      intervalMs: 60_000,
      keyPrefix: 't2',
      extraKey: 'u1',
    })?.status,
    429,
    'a new IP is not a new bucket for the same user'
  );
});

test('the admin order edit can only close unpaid orders', async () => {
  const edit = async (orderNo: string, status: string) => {
    const res = await patchOrder({
      request: new Request('http://localhost/api/admin/orders', {
        method: 'PATCH',
        body: JSON.stringify({ orderNo, status, description: 'note' }),
      }),
      actor: {},
    } as any);
    return (await res.json()).code;
  };
  const paidOrder = await createdOrder('ORD-EDIT-PAID', 'stripe', 500);
  await db()
    .update(schema.order)
    .set({ status: 'paid' })
    .where(eq(schema.order.id, paidOrder.id));
  assert.notEqual(
    await edit('ORD-EDIT-PAID', 'pending'),
    0,
    'paid → pending refused'
  );
  assert.notEqual(
    await edit('ORD-EDIT-PAID', 'refunded'),
    0,
    'paid → refunded refused'
  );
  assert.equal(
    await edit('ORD-EDIT-PAID', 'paid'),
    0,
    'unchanged status with other edits is fine'
  );
  await createdOrder('ORD-EDIT-OPEN', 'stripe', 500);
  assert.notEqual(
    await edit('ORD-EDIT-OPEN', 'paid'),
    0,
    'created → paid refused'
  );
  assert.equal(
    await edit('ORD-EDIT-OPEN', 'failed'),
    0,
    'created → failed allowed'
  );
  const [row] = await db()
    .select()
    .from(schema.order)
    .where(eq(schema.order.orderNo, 'ORD-EDIT-PAID'));
  assert.equal(row.status, 'paid');
});

test('the Plausible script must come from plausible.io or a deployment-listed host', () => {
  assert.equal(
    isValidEmbedSetting('plausible_src', 'https://plausible.io/js/pa-abc.js'),
    true
  );
  assert.equal(
    isValidEmbedSetting('plausible_src', 'https://evil.example/x.js'),
    false
  );
  assert.equal(
    isValidEmbedSetting(
      'plausible_src',
      'https://plausible.io.evil.example/x.js'
    ),
    false
  );
  assert.equal(
    isValidEmbedSetting('plausible_src', 'http://plausible.io/js/script.js'),
    false
  );
  assert.equal(isValidEmbedSetting('plausible_src', '/js/script.js'), true);
  for (const src of [
    '//evil.example/x.js',
    '/\\evil.example/x.js',
    '/\\/evil.example/x.js',
  ])
    assert.equal(isValidEmbedSetting('plausible_src', src), false, src);
  // Runtime server env, and the older build-time name, both count.
  for (const name of [
    'PLAUSIBLE_SCRIPT_HOSTS',
    'VITE_PLAUSIBLE_SCRIPT_HOSTS',
  ]) {
    process.env[name] = 'other.example, Stats.Example.com';
    assert.equal(
      isValidEmbedSetting(
        'plausible_src',
        'https://stats.example.com/js/script.js'
      ),
      true,
      name
    );
    delete process.env[name];
  }
  assert.equal(
    isValidEmbedSetting(
      'plausible_src',
      'https://stats.example.com/js/script.js'
    ),
    false
  );
  (globalThis as any).__CF_ENV__ = {
    PLAUSIBLE_SCRIPT_HOSTS: 'stats.example.com',
  };
  assert.equal(
    isValidEmbedSetting(
      'plausible_src',
      'https://stats.example.com/js/script.js'
    ),
    true
  );
  delete (globalThis as any).__CF_ENV__;
});
