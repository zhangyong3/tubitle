import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { verifyPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';

// Isolated SQLite DB; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-password-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-password-test-secret-not-a-real-credential',
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
const { POST: setPassword } =
  await import('../src/server/admin/handlers/users-password');

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

await db()
  .insert(schema.role)
  .values({ id: 'super', name: 'super_admin', title: 's', status: 'active' });
await db()
  .insert(schema.permission)
  .values({ id: 'p-all', code: '*', resource: 'x', action: 'x', title: '*' });
await db()
  .insert(schema.rolePermission)
  .values({ id: 'rp-all', roleId: 'super', permissionId: 'p-all' });
for (const id of ['boss', 'member', 'oauth'])
  await db()
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@example.test` });
await db()
  .insert(schema.userRole)
  .values({ id: 'ur-boss', userId: 'boss', roleId: 'super' });
await db().insert(schema.account).values({
  id: 'acc-member',
  accountId: 'member',
  providerId: 'credential',
  userId: 'member',
  password: 'old-hash',
});
await db()
  .insert(schema.session)
  .values({
    id: 's-member',
    token: 't-member',
    userId: 'member',
    expiresAt: new Date(Date.now() + 86_400_000),
  });

const superAdmin = { userId: 'boss', permissions: ['*'] };
const passwordAdmin = {
  userId: 'helper',
  permissions: ['admin.access', 'admin.passwords.reset'],
};
const call = async (actor: any, userId: string, password: string) =>
  (
    await (
      await setPassword({
        request: new Request('http://admin.internal/users/password', {
          method: 'POST',
          body: JSON.stringify({ userId, password }),
        }),
        params: {},
        actor,
      })
    ).json()
  ).code;

async function credentialHash(userId: string) {
  const [row] = await db()
    .select({ password: schema.account.password })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential')
      )
    );
  return row?.password;
}

test('setting a password replaces the hash and signs the user out', async () => {
  assert.equal(await call(superAdmin, 'member', 'new-pass-123'), 0);
  const hash = await credentialHash('member');
  assert.ok(await verifyPassword({ hash: hash!, password: 'new-pass-123' }));
  const sessions = await db()
    .select()
    .from(schema.session)
    .where(eq(schema.session.userId, 'member'));
  assert.equal(sessions.length, 0);
});

test('an OAuth-only user gets an email/password login', async () => {
  assert.equal(await credentialHash('oauth'), undefined);
  assert.equal(await call(superAdmin, 'oauth', 'oauth-pass-1'), 0);
  const hash = await credentialHash('oauth');
  assert.ok(await verifyPassword({ hash: hash!, password: 'oauth-pass-1' }));
});

test("a user whose roles exceed the caller's permissions is refused", async () => {
  const before = await credentialHash('boss');
  assert.notEqual(await call(passwordAdmin, 'boss', 'takeover-123'), 0);
  assert.equal(await credentialHash('boss'), before);
});

test('agent API keys and short passwords are refused', async () => {
  assert.notEqual(
    await call({ ...superAdmin, tokenId: 'key-1' }, 'member', 'agent-pass-1'),
    0
  );
  assert.notEqual(await call(superAdmin, 'member', 'short'), 0);
});
