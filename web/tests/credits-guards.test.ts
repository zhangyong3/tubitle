import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';

// Isolated SQLite database; no application modules load before the env is set.
// Real concurrency needs Postgres/MySQL (SQLite serializes writers), so these
// cover the guards' sequential behavior.
const directory = await mkdtemp(join(tmpdir(), 'shipany-credits-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-credits-test-secret-not-a-real-credential',
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
const { credit, user } = await import('../src/config/db/schema');
const { consume, getBalance, grant, revoke } =
  await import('../src/modules/credits/service');

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const userId = 'user-credits';
await db()
  .insert(user)
  .values({ id: userId, name: 'User', email: 'credits@example.test' });

const consumeRecords = () =>
  db()
    .select()
    .from(credit)
    .where(
      and(eq(credit.userId, userId), eq(credit.transactionType, 'consume'))
    );

test('consuming more than the balance changes nothing', async () => {
  await grant({ userId, credits: 30, description: 'a' });
  await grant({ userId, credits: 20, description: 'b' });

  const result = await consume({ userId, credits: 60 });
  assert.equal(result.success, false);
  assert.equal(await getBalance(userId), 50);
  assert.equal((await consumeRecords()).length, 0);
});

test('a consume spanning several grants deducts exactly once', async () => {
  const result = await consume({ userId, credits: 40 });
  assert.equal(result.success, true);
  assert.equal(await getBalance(userId), 10);
  assert.equal((await consumeRecords()).length, 1);
});

test('revoking the same consumption twice restores it once', async () => {
  const [record] = await consumeRecords();
  await revoke(record.id);
  await revoke(record.id);
  assert.equal(await getBalance(userId), 50);
});

test('consume rejects non-positive or fractional amounts', async () => {
  for (const credits of [0, -5, 1.5]) {
    await assert.rejects(consume({ userId, credits }));
  }
  assert.equal(await getBalance(userId), 50);
});
