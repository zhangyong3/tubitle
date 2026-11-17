import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';

// Isolated SQLite DB; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-refund-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-refund-test-secret-not-a-real-credential',
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
const { refundOrder } = await import('../src/modules/payment/service');
const { getBalance, consume } = await import('../src/modules/credits/service');

let seq = 0;
async function paidOrder(
  userId: string,
  values: Partial<typeof schema.order.$inferInsert> = {}
) {
  const orderNo = `ORD-${++seq}`;
  await db()
    .insert(schema.order)
    .values({
      id: orderNo,
      orderNo,
      userId,
      status: 'paid',
      amount: 0,
      paymentAmount: 0,
      currency: 'usd',
      paymentProvider: 'stripe',
      checkoutInfo: '{}',
      paymentType: 'one-time',
      ...values,
    });
  return orderNo;
}
async function grant(
  userId: string,
  credits: number,
  orderNo: string,
  expiresAt: Date | null = null
) {
  await db()
    .insert(schema.credit)
    .values({
      id: `c-${++seq}`,
      userId,
      orderNo,
      transactionNo: `t-${seq}`,
      transactionType: 'grant',
      transactionScene: 'payment',
      credits,
      remainingCredits: credits,
      status: 'active',
      expiresAt,
    });
}
async function orderRow(orderNo: string) {
  const [row] = await db()
    .select()
    .from(schema.order)
    .where(eq(schema.order.orderNo, orderNo));
  return row;
}

before(async () => {
  await db()
    .insert(schema.user)
    .values([
      { id: 'u1', name: 'A', email: 'a@example.test' },
      { id: 'u2', name: 'B', email: 'b@example.test' },
      { id: 'u3', name: 'C', email: 'c@example.test' },
    ]);
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('refund deducts the order grant first, marks the order refunded and cannot run twice', async () => {
  const orderNo = await paidOrder('u1', { creditsAmount: 100 });
  // An earlier-expiring grant from another order would win plain FIFO.
  await grant('u1', 50, 'OTHER', new Date(Date.now() + 86400_000));
  await grant('u1', 100, orderNo);

  const result = await refundOrder({
    orderNo,
    operatorId: 'admin',
    reason: 'test',
  });
  assert.equal(result.creditsDeducted, 100);
  assert.equal(await getBalance('u1'), 50);

  const [other] = await db()
    .select()
    .from(schema.credit)
    .where(eq(schema.credit.orderNo, 'OTHER'));
  assert.equal(other.remainingCredits, 50, 'other grant untouched');
  const [record] = await db()
    .select()
    .from(schema.credit)
    .where(
      and(
        eq(schema.credit.orderNo, orderNo),
        eq(schema.credit.transactionType, 'consume')
      )
    );
  assert.equal(record.credits, -100);
  assert.equal(record.transactionScene, 'refund');

  const row = await orderRow(orderNo);
  assert.equal(row.status, 'refunded');
  assert.ok(row.refundedAt);
  assert.equal(JSON.parse(row.refundResult!).operatorId, 'admin');

  await assert.rejects(
    refundOrder({ orderNo, operatorId: 'admin' }),
    /Only paid orders/
  );
  assert.equal(await getBalance('u1'), 50, 'second attempt deducts nothing');
});

test('partly spent credits: deducts from other grants, never below zero', async () => {
  const orderNo = await paidOrder('u2', { creditsAmount: 100 });
  await grant('u2', 100, orderNo);
  await grant('u2', 30, 'OTHER2');
  assert.equal((await consume({ userId: 'u2', credits: 80 })).success, true);
  assert.equal(await getBalance('u2'), 50);

  const result = await refundOrder({ orderNo, operatorId: 'admin' });
  assert.equal(result.creditsRequested, 100);
  assert.equal(result.creditsDeducted, 50);
  assert.equal(await getBalance('u2'), 0);
});

test('deductCredits override, including 0', async () => {
  const orderNo = await paidOrder('u3', { creditsAmount: 100 });
  await grant('u3', 100, orderNo);
  const result = await refundOrder({
    orderNo,
    operatorId: 'admin',
    deductCredits: 0,
  });
  assert.equal(result.creditsDeducted, 0);
  assert.equal(await getBalance('u3'), 100);
});

test('paid order on an unconfigured provider is rejected without changing state', async () => {
  const orderNo = await paidOrder('u3', {
    amount: 999,
    paymentAmount: 999,
    creditsAmount: 10,
  });
  await assert.rejects(
    refundOrder({ orderNo, operatorId: 'admin' }),
    /not supported for provider/
  );
  const row = await orderRow(orderNo);
  assert.equal(row.status, 'paid');
  assert.equal(row.refundResult, null);
});

test('an in-flight refund blocks a second one', async () => {
  const orderNo = await paidOrder('u3');
  await db()
    .update(schema.order)
    .set({ status: 'refunding' })
    .where(eq(schema.order.orderNo, orderNo));
  await assert.rejects(
    refundOrder({ orderNo, operatorId: 'admin' }),
    /already in progress/
  );
});
