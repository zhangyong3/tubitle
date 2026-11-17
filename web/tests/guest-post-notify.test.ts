import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

// Isolated SQLite database and a local webhook receiver; no real channel.
const directory = await mkdtemp(join(tmpdir(), 'shipany-gp-notify-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-gp-notify-test-secret-not-a-real-credential',
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

const received: any[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;

const { db } = await import('../src/core/db');
const { order, user } = await import('../src/config/db/schema');
const { saveConfigs } = await import('../src/modules/config/service');
const gp = await import('../src/modules/guest-posts/service');
const { settleCheckoutOrder } = await import('../src/modules/payment/service');
const notify = await import('../src/modules/notify/service');

after(async () => {
  server.close();
  await rm(directory, { recursive: true, force: true });
});

await saveConfigs({
  notify_webhook_url: `http://127.0.0.1:${port}/hook`,
  notify_language: 'zh',
});
await db().insert(user).values({
  id: 'author-n',
  name: 'Jane',
  email: 'jane@example.test',
  country: 'US',
});

async function paidDraft() {
  const id = await gp.createGuestPost({
    userId: 'author-n',
    authorName: 'Jane',
    productId: 'guest_post_premium',
    input: { title: '截图工具评测', slug: 'screenshot-review', content: 'x' },
  });
  await db()
    .insert(order)
    .values({
      id: 'o-n',
      orderNo: 'ORD-N',
      userId: 'author-n',
      userEmail: 'jane@example.test',
      status: 'created',
      amount: 19900,
      currency: 'usd',
      productId: 'guest_post_premium',
      paymentType: 'one-time',
      paymentProvider: 'stripe',
      checkoutInfo: '{}',
      creditsAmount: 0,
      reference: gp.guestPostOrderReference(id),
    });
  const [o] = await db().select().from(order).where(eq(order.orderNo, 'ORD-N'));
  await settleCheckoutOrder(
    o,
    {
      paymentStatus: 'paid',
      paymentResult: {},
      paymentInfo: { transactionId: 'pi_n', paidAt: new Date() },
    },
    'stripe'
  );
  return id;
}

test('paying sends "awaiting review" with package, amount and links (on by default)', async () => {
  const id = await paidDraft();
  const msgs = received.filter((m) => m.event === 'guest_post.submitted');
  assert.equal(msgs.length, 1, 'one guest post message');
  const { text, data } = msgs[0];
  // Site name in the title, so one bot can serve several sites.
  assert.match(text, /^【.+】新投稿待审核/);
  assert.doesNotMatch(text, /产品：/);
  assert.match(text, /标题：截图工具评测/);
  assert.match(text, /套餐：Premium（\$199\.00）/);
  assert.match(text, /作者：Jane <jane@example\.test>/);
  assert.equal(
    data.preview_url,
    'http://localhost:3000/blog/screenshot-review?preview=1'
  );
  assert.equal(
    data.admin_url,
    `http://localhost:3000/admin/guest-posts?id=${id}`
  );
});

test('a resubmission says so', async () => {
  const [{ id }] = (await gp.listUserGuestPosts('author-n')).items;
  received.length = 0;
  await notify.notifyGuestPostSubmitted(id, 'resubmitted');
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'guest_post.resubmitted');
  assert.match(received[0].text, /】投稿重新提交/);
});

test('turning the switch off stops it', async () => {
  const [{ id }] = (await gp.listUserGuestPosts('author-n')).items;
  await saveConfigs({ notify_guest_post_enabled: 'false' });
  received.length = 0;
  await notify.notifyGuestPostSubmitted(id);
  assert.equal(received.length, 0);
});

test('the settings Test button has a guest post sample', async () => {
  received.length = 0;
  const results = await notify.sendTestGuestPostNotification({
    notify_webhook_url: `http://127.0.0.1:${port}/hook`,
    notify_language: 'en',
  });
  assert.deepEqual(results, [{ channel: 'webhook', success: true }]);
  assert.equal(received[0].test, true);
  assert.match(received[0].text, /^\[Test\] \[.+\] Guest post awaiting review/);
});
