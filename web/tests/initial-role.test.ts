import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// Isolated SQLite database; no application modules load before the env is set.
const directory = await mkdtemp(join(tmpdir(), 'shipany-role-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-role-test-secret-not-a-real-credential',
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
const { permission, role, rolePermission, user } =
  await import('../src/config/db/schema');
const { getUserPermissionCodes, grantRoleForNewUser } =
  await import('../src/modules/rbac/service');

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function seedRole(name: string, codes: string[]) {
  await db()
    .insert(role)
    .values({ id: name, name, title: name, status: 'active' });
  for (const code of codes) {
    const id = `${name}-${code}`;
    await db()
      .insert(permission)
      .values({ id, code, resource: 'x', action: 'x', title: code });
    await db()
      .insert(rolePermission)
      .values({ id, roleId: name, permissionId: id });
  }
}

async function signUp(id: string, roleName: string) {
  await db()
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test` });
  await grantRoleForNewUser({
    userId: id,
    configs: { initial_role_enabled: 'true', initial_role_name: roleName },
  });
  return getUserPermissionCodes(id);
}

await seedRole('super_admin', ['*']);
await seedRole('editor', ['admin.access', 'admin.posts.write']);
await seedRole('member', ['app.generate']);

test('an admin role set as the signup default is never granted', async () => {
  assert.deepEqual(await signUp('u-super', 'super_admin'), []);
  assert.deepEqual(await signUp('u-editor', 'editor'), []);
});

test('a non-admin signup role is still granted', async () => {
  assert.deepEqual(await signUp('u-member', 'member'), ['app.generate']);
});
