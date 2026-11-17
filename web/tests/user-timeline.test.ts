import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// Isolated SQLite DB; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-timeline-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-timeline-test-secret-not-a-real-credential',
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
const { GET: timeline } =
  await import('../src/server/admin/handlers/users-timeline');

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const t0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const at = (minutes: number) => new Date(t0 + minutes * 60_000);

await db()
  .insert(schema.user)
  .values({
    id: 'u1',
    name: 'U',
    email: 'u1@example.test',
    utmSource: 'google',
    createdAt: at(0),
  });
await db()
  .insert(schema.order)
  .values({
    id: 'o1',
    orderNo: 'ORD-1',
    userId: 'u1',
    status: 'paid',
    amount: 990,
    currency: 'usd',
    paymentProvider: 'stripe',
    checkoutInfo: '{}',
    productName: 'Starter',
    createdAt: at(1),
    paidAt: at(2),
  });
await db()
  .insert(schema.credit)
  .values({
    id: 'c1',
    userId: 'u1',
    transactionNo: 'grant_ORD-1',
    transactionType: 'grant',
    credits: 100,
    remainingCredits: 100,
    status: 'active',
    createdAt: at(2),
  });
// Several events in the same millisecond to exercise the tie-break.
for (const [id, status] of [
  ['a1', 'success'],
  ['a2', 'failed'],
  ['a3', 'success'],
] as const)
  await db()
    .insert(schema.aiTask)
    .values({
      id,
      userId: 'u1',
      mediaType: 'image',
      provider: 'fal',
      model: 'flux',
      prompt: 'p',
      status,
      costCredits: 10,
      createdAt: at(3),
      updatedAt: at(3),
    });

// Provider paid_at has second precision and can read earlier than the order.
await db()
  .insert(schema.order)
  .values({
    id: 'o2',
    orderNo: 'ORD-2',
    userId: 'u1',
    status: 'paid',
    amount: 2900,
    currency: 'usd',
    paymentProvider: 'stripe',
    checkoutInfo: '{}',
    createdAt: new Date(at(5).getTime() + 400),
    paidAt: at(5),
  });

test('a payment never shows before its order was created', async () => {
  const { items } = await fetchPage(undefined, 100, 'asc');
  const keys = items.map((e) => e.key);
  assert.ok(keys.indexOf('order_created:o2') < keys.indexOf('order_paid:o2'));
});

async function fetchPage(
  cursor?: string,
  limit = 3,
  order: 'asc' | 'desc' = 'desc'
) {
  const params = new URLSearchParams({
    userId: 'u1',
    limit: String(limit),
    order,
  });
  if (cursor) params.set('cursor', cursor);
  const res = await timeline({
    request: new Request(`http://admin.internal/users/timeline?${params}`),
    params: {},
    actor: { userId: 'admin', permissions: ['*'] },
  } as any);
  const body = await res.json();
  assert.equal(body.code, 0, body.message);
  return body.data as {
    items: { key: string; at: string; kind: string; detail: any }[];
    nextCursor: string | null;
  };
}

test('events from every source merge newest first', async () => {
  const { items } = await fetchPage(undefined, 100);
  const kinds = items.map((e) => e.kind);
  assert.deepEqual(kinds.slice(-4), [
    'credits_granted', // same instant as the payment: granted comes after paid
    'order_paid',
    'order_created',
    'signup',
  ]);
  assert.equal(kinds.filter((k) => k === 'task_created').length, 3);
  assert.equal(kinds.filter((k) => k === 'task_failed').length, 1);
  assert.equal(items.at(-1)!.detail.source, 'google');
  for (let i = 1; i < items.length; i++)
    assert.ok(items[i - 1].at >= items[i].at, 'sorted newest first');
});

for (const order of ['desc', 'asc'] as const)
  test(`paging (${order}) returns every event exactly once`, async () => {
    const all = (await fetchPage(undefined, 100, order)).items.map(
      (e) => e.key
    );
    if (order === 'asc') {
      const desc = (await fetchPage(undefined, 100)).items.map((e) => e.key);
      assert.deepEqual(all, [...desc].reverse(), 'asc mirrors desc');
      assert.equal(all[0], 'signup:u1');
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await fetchPage(cursor, 3, order);
      seen.push(...page.items.map((e) => e.key));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(seen, all);
  });
