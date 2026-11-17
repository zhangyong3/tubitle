import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';

// Isolated SQLite DB; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-events-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-events-test-secret-not-a-real-credential',
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
const { parseClientEvent, recordEvent, sanitizeEventDetail } =
  await import('../src/modules/events/service');
const { customTimelineSources } =
  await import('../src/server/admin/timeline-sources');
const { GET: timeline } =
  await import('../src/server/admin/handlers/users-timeline');
const { Route: eventsRoute } = await import('../src/routes/api/events');

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

await db()
  .insert(schema.user)
  .values({ id: 'u1', name: 'U', email: 'u1@example.test' });

test('detail must be flat, small and well-keyed', () => {
  assert.deepEqual(sanitizeEventDetail({ plan: 'pro', n: 2, ok: true }), {
    detail: { plan: 'pro', n: 2, ok: true },
  });
  for (const bad of [
    { nested: { a: 1 } },
    { list: [1] },
    { long: 'x'.repeat(201) },
    { 'bad-key': 1 },
    Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])),
    'text',
    [1],
  ])
    assert.ok('error' in sanitizeEventDetail(bad), JSON.stringify(bad));
});

test('the browser may only report kinds registered with client: true', () => {
  assert.equal(
    (
      parseClientEvent({
        kind: 'plan_selected',
        detail: { plan: 'pro' },
      }) as any
    ).kind,
    'plan_selected'
  );
  for (const kind of ['risk_flagged', 'order_paid', 'nope', '__proto__'])
    assert.ok('error' in parseClientEvent({ kind }), kind);
});

test('recordEvent writes registered kinds and refuses others without throwing', async () => {
  assert.equal(
    await recordEvent({
      userId: 'u1',
      kind: 'risk_flagged',
      detail: { reason: 'ip_burst' },
    }),
    true
  );
  assert.equal(
    await recordEvent({ userId: 'u1', kind: 'made_up' as any }),
    false
  );
  assert.equal(
    await recordEvent({ userId: 'missing-user', kind: 'paywall_hit' }),
    false,
    'a failing insert (FK) is swallowed'
  );
  const rows = await db()
    .select()
    .from(schema.userEvent)
    .where(eq(schema.userEvent.userId, 'u1'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'server');
});

test('POST /api/events refuses cross-origin and signed-out callers', async () => {
  const post = (eventsRoute.options as any).server.handlers.POST;
  const call = async (origin: string | null) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200)}`,
    };
    if (origin) headers.origin = origin;
    return post({
      request: new Request('http://localhost:3000/api/events', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'plan_selected' }),
      }),
    });
  };
  assert.equal((await call('https://evil.example')).status, 403);
  assert.equal((await call(null)).status, 403);
  assert.equal((await call('http://localhost:3000')).status, 401);
  const rows = await db()
    .select()
    .from(schema.userEvent)
    .where(
      and(
        eq(schema.userEvent.userId, 'u1'),
        eq(schema.userEvent.kind, 'plan_selected')
      )
    );
  assert.equal(rows.length, 0);
});

test('the timeline shows product events and custom sources', async () => {
  customTimelineSources.push({
    kind: 'gift_template',
    load: async () => [
      {
        id: 'g1',
        at: new Date(),
        detail: { template: 'Resume' },
        href: '/admin/gifts?id=g1',
      },
      { id: 'g2', at: new Date(), href: '//evil.example/x' },
    ],
  });
  const res = await timeline({
    request: new Request('http://admin.internal/users/timeline?userId=u1'),
    params: {},
    actor: { userId: 'admin', permissions: ['*'] },
  } as any);
  const { data } = await res.json();
  const risk = data.items.find((e: any) => e.kind === 'risk_flagged');
  assert.deepEqual(risk.detail, { reason: 'ip_burst' });
  const g1 = data.items.find((e: any) => e.key === 'gift_template:g1');
  const g2 = data.items.find((e: any) => e.key === 'gift_template:g2');
  assert.equal(g1.href, '/admin/gifts?id=g1');
  assert.equal(g2.href, undefined, 'protocol-relative hrefs are dropped');
  customTimelineSources.length = 0;
});
