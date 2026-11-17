import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { eq } from 'drizzle-orm';

// No application modules are loaded until the isolated environment is installed.
const directory = await mkdtemp(join(tmpdir(), 'shipany-admin-test-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-admin-test-secret-not-a-real-credential',
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
const access = await import('../src/modules/admin-access/service');
const { getBalance } = await import('../src/modules/credits/service');
const { getUserPermissionCodes } = await import('../src/modules/rbac/service');
const { authenticateAdmin } = await import('../src/server/admin/auth');
const { getAuth } = await import('../src/core/auth');
const { hashPassword } = await import('better-auth/crypto');
const { runAdminRoute, executeAdmin, findOperation, adminErrorResponse } =
  await import('../src/server/admin/execute');
const { operationCatalog, adminOpenApi } =
  await import('../src/server/admin/discovery');
const { handleAdminMcp } = await import('../src/server/admin/mcp');
const { adminOperations } = await import('../src/lib/admin-operations');
const apikeys = await import('../src/modules/apikeys/service');
const { Route: keysRoute } = await import('../src/routes/api/admin/agent/keys');
const { Route: executeRoute } =
  await import('../src/routes/api/admin/agent/execute');
let fullToken: string;
let readToken: string;
let fullAgentId: string;
let readAgentId: string;
let baseUrl: string;
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const request = new Request(`${baseUrl}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      ...(['GET', 'HEAD'].includes(incoming.method!)
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    let response: Response;
    if (incoming.url === '/api/admin/agent/mcp')
      response = await handleAdminMcp(request);
    else if (incoming.url === '/api/admin/agent/operations')
      response = Response.json({
        code: 0,
        message: 'ok',
        data: operationCatalog(await authenticateAdmin(request)),
      });
    else if (incoming.url === '/api/admin/agent/execute') {
      const actor = await authenticateAdmin(request);
      const body = await request.json();
      try {
        response = await executeAdmin(
          findOperation(body.operation),
          body.input,
          actor,
          body.idempotencyKey
        );
      } catch (error) {
        response = adminErrorResponse(error);
      }
    } else response = new Response(null, { status: 404 });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const response = adminErrorResponse(error);
    outgoing.writeHead(response.status, { 'content-type': 'application/json' });
    outgoing.end(await response.text());
  }
});

before(async () => {
  await db()
    .insert(schema.user)
    .values([
      { id: 'owner', name: 'Admin', email: 'owner@example.test' },
      { id: 'target', name: 'Target', email: 'target@example.test' },
      { id: 'viewer', name: 'Viewer', email: 'viewer@example.test' },
    ]);
  await db()
    .insert(schema.role)
    .values([
      {
        id: 'owner-role',
        name: 'admin-test',
        title: 'Admin',
        status: 'active',
      },
      {
        id: 'viewer-role',
        name: 'viewer-test',
        title: 'Viewer',
        status: 'active',
      },
    ]);
  await db()
    .insert(schema.permission)
    .values([
      { id: 'all', code: '*', resource: 'admin', action: '*', title: 'All' },
      {
        id: 'read',
        code: 'admin.users.read',
        resource: 'users',
        action: 'read',
        title: 'Read',
      },
    ]);
  await db()
    .insert(schema.rolePermission)
    .values([
      { id: 'rp1', roleId: 'owner-role', permissionId: 'all' },
      { id: 'rp2', roleId: 'viewer-role', permissionId: 'read' },
    ]);
  await db()
    .insert(schema.userRole)
    .values([
      { id: 'ur1', userId: 'owner', roleId: 'owner-role' },
      { id: 'ur2', userId: 'viewer', roleId: 'viewer-role' },
    ]);
  // Agents are api-type users; their RBAC roles are their permissions.
  fullAgentId = (
    await access.createAgent({
      name: 'Full agent',
      roleIds: ['owner-role'],
      operatorPermissions: ['*'],
    })
  ).id;
  readAgentId = (
    await access.createAgent({
      name: 'Read agent',
      roleIds: ['viewer-role'],
      operatorPermissions: ['*'],
    })
  ).id;
  fullToken = (
    await access.createAgentKey({
      agentId: fullAgentId,
      name: 'Test',
      expiresAt: new Date(Date.now() + 3600_000),
    })
  ).token;
  readToken = (
    await access.createAgentKey({
      agentId: readAgentId,
      name: 'Read',
      expiresAt: new Date(Date.now() + 3600_000),
    })
  ).token;
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(directory, { recursive: true, force: true });
});
function request(
  operation: string,
  input: Record<string, unknown>,
  token = fullToken,
  key?: string
) {
  const definition = findOperation(operation);
  const path = definition.path.replace('{id}', String(input.id));
  const url = new URL(path, baseUrl || 'http://localhost');
  const body = { ...input };
  if (definition.path.includes('{id}')) delete body.id;
  const query = ['GET', 'DELETE'].includes(definition.method);
  if (query)
    for (const [key, value] of Object.entries(body))
      url.searchParams.set(key, String(value));
  return runAdminRoute(operation, {
    request: new Request(url, {
      method: definition.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(query ? {} : { body: JSON.stringify(body) }),
    }),
    ...(definition.path.includes('{id}')
      ? { params: { id: String(input.id) } }
      : {}),
  });
}

test('all registered operations have matching handlers, unique method/path and JSON schemas', async () => {
  const { handlers } = await import('../src/server/admin/handlers');
  assert(adminOperations.length >= 38);
  assert.deepEqual(
    adminOperations.map((op) => op.name).sort(),
    Object.keys(handlers).sort()
  );
  assert.equal(
    new Set(adminOperations.map((op) => `${op.method} ${op.path}`)).size,
    adminOperations.length
  );
  const actor = await authenticateAdmin(
    new Request(baseUrl, { headers: { Authorization: `Bearer ${fullToken}` } })
  );
  assert.equal(operationCatalog(actor).length, adminOperations.length);
  assert.equal(
    Object.values(adminOpenApi(actor).paths).reduce(
      (n, path) => n + Object.keys(path).length,
      0
    ),
    adminOperations.length
  );
});
test('agent permissions are exactly its RBAC roles, and roles can never exceed the operator', async () => {
  const actor = await authenticateAdmin(
    new Request(baseUrl, { headers: { Authorization: `Bearer ${readToken}` } })
  );
  assert.deepEqual(
    operationCatalog(actor).map((op) => op.name),
    ['users_list', 'users_sources', 'users_get', 'users_timeline']
  );
  assert.equal((await request('users_list', {}, readToken)).status, 200);
  assert.equal(
    (
      await request(
        'credits_adjust',
        { userId: 'target', action: 'grant', credits: 50 },
        readToken,
        'denied-write'
      )
    ).status,
    403
  );
  // An operator holding only users.read cannot hand out the '*' role.
  await assert.rejects(
    access.createAgent({
      name: 'Escalation',
      roleIds: ['owner-role'],
      operatorPermissions: ['admin.users.read'],
    }),
    /do not have/
  );
  await assert.rejects(
    access.updateAgent({
      id: readAgentId,
      roleIds: ['owner-role'],
      operatorPermissions: ['admin.*'],
    }),
    /do not have/
  );
  // Disabling a role revokes the agent's access on the next call.
  await db().insert(schema.role).values({
    id: 'temp-role',
    name: 'temp-test',
    title: 'Temp',
    status: 'active',
  });
  await db()
    .insert(schema.rolePermission)
    .values({ id: 'rp3', roleId: 'temp-role', permissionId: 'read' });
  const temp = await access.createAgent({
    name: 'Temp agent',
    roleIds: ['temp-role'],
    operatorPermissions: ['*'],
  });
  const tempKey = await access.createAgentKey({
    agentId: temp.id,
    name: 'Temp',
    expiresAt: null,
  });
  assert.equal((await request('users_list', {}, tempKey.token)).status, 200);
  await db()
    .update(schema.role)
    .set({ status: 'inactive' })
    .where(eq(schema.role.id, 'temp-role'));
  assert.deepEqual(await getUserPermissionCodes(temp.id), []);
  assert.equal((await request('users_list', {}, tempKey.token)).status, 403);
  // Agents are service accounts, not users: never listed as such.
  const list = await (await request('users_list', { pageSize: 100 })).json();
  assert.equal(list.data.total, 3);
  assert(
    !list.data.items.some((u: { id: string }) =>
      [fullAgentId, readAgentId, temp.id].includes(u.id)
    )
  );
});
test('RBAC writes cannot exceed the caller: no self-escalation to super_admin', async () => {
  await db()
    .insert(schema.permission)
    .values([
      {
        id: 'p-rr',
        code: 'admin.roles.read',
        resource: 'roles',
        action: 'read',
        title: 'R',
      },
      {
        id: 'p-rw',
        code: 'admin.roles.write',
        resource: 'roles',
        action: 'write',
        title: 'W',
      },
      {
        id: 'p-rd',
        code: 'admin.roles.delete',
        resource: 'roles',
        action: 'delete',
        title: 'D',
      },
      {
        id: 'p-pw',
        code: 'admin.permissions.write',
        resource: 'permissions',
        action: 'write',
        title: 'PW',
      },
      {
        id: 'p-pd',
        code: 'admin.permissions.delete',
        resource: 'permissions',
        action: 'delete',
        title: 'PD',
      },
    ]);
  await db().insert(schema.role).values({
    id: 'rbac-role',
    name: 'rbac-test',
    title: 'RBAC',
    status: 'active',
  });
  await db()
    .insert(schema.rolePermission)
    .values(
      ['p-rr', 'p-rw', 'p-rd', 'p-pw', 'p-pd', 'read'].map((permissionId) => ({
        id: `rbac-${permissionId}`,
        roleId: 'rbac-role',
        permissionId,
      }))
    );
  const agent = await access.createAgent({
    name: 'RBAC agent',
    roleIds: ['rbac-role'],
    operatorPermissions: ['*'],
  });
  const { token } = await access.createAgentKey({
    agentId: agent.id,
    name: 'k',
    expiresAt: null,
  });
  const denied = async (
    op: string,
    input: Record<string, unknown>,
    key: string
  ) => {
    const res = await request(op, input, token, key);
    return res.status === 403 && (await res.json()).code !== 0;
  };
  // The PoC: assigning super_admin (owner-role holds '*') to itself.
  assert(
    await denied(
      'roles_assign',
      { userId: agent.id, roleId: 'owner-role' },
      'esc-assign'
    )
  );
  // Nor demote / disable a role above it.
  assert(
    await denied(
      'roles_unassign',
      { userId: 'owner', roleId: 'owner-role' },
      'esc-unassign'
    )
  );
  assert(await denied('roles_delete', { id: 'owner-role' }, 'esc-delete'));
  // Nor attach '*' to its own role, define a '*' permission, or rename one to '*'.
  assert(
    await denied(
      'roles_permissions_update',
      { roleId: 'rbac-role', permissionIds: ['all'] },
      'esc-attach'
    )
  );
  assert(
    await denied(
      'permissions_create',
      { code: '*', resource: 'admin', action: '*', title: 'x' },
      'esc-create'
    )
  );
  assert(
    await denied('permissions_update', { id: 'p-rr', code: '*' }, 'esc-rename')
  );
  assert(await denied('permissions_delete', { id: 'all' }, 'esc-perm-delete'));
  assert.deepEqual((await getUserPermissionCodes(agent.id)).sort(), [
    'admin.permissions.delete',
    'admin.permissions.write',
    'admin.roles.delete',
    'admin.roles.read',
    'admin.roles.write',
    'admin.users.read',
  ]);
  // Within its own permissions it still works: grant the viewer role.
  const ok = await request(
    'roles_assign',
    { userId: 'target', roleId: 'viewer-role' },
    token,
    'ok-assign'
  );
  assert.equal((await ok.json()).code, 0);
  // Humans are held to the same ceiling.
  const limited = { userId: 'viewer', permissions: ['admin.roles.write'] };
  const { executeAdmin: run, findOperation: find } =
    await import('../src/server/admin/execute');
  const res = await run(
    find('roles_assign'),
    { userId: 'viewer', roleId: 'owner-role' },
    limited
  );
  assert.equal(res.status, 403);
});
test('admin keys are hash-only, expire, revoke immediately, and never cross with product keys', async () => {
  const created = await access.createAgentKey({
    agentId: readAgentId,
    name: 'Revoke',
    expiresAt: new Date(Date.now() + 10000),
  });
  const [stored] = await db()
    .select()
    .from(schema.apikey)
    .where(eq(schema.apikey.id, created.id));
  assert(!JSON.stringify(stored).includes(created.token));
  assert.equal(stored.key, null);
  assert.equal(stored.type, 'admin');
  assert.equal(stored.keyHash.length, 64);
  await access.revokeAgentKey(created.id, fullAgentId);
  assert(await access.validateAdminKey(created.token));
  await access.revokeAgentKey(created.id, readAgentId);
  assert.equal((await request('users_list', {}, created.token)).status, 401);
  const expired = await access.createAgentKey({
    agentId: readAgentId,
    name: 'Expired',
    expiresAt: new Date(Date.now() - 10000),
  });
  assert.equal((await request('users_list', {}, expired.token)).status, 401);
  const forever = await access.createAgentKey({
    agentId: readAgentId,
    name: 'Never expires',
    expiresAt: null,
  });
  assert.equal((await request('users_list', {}, forever.token)).status, 200);
  await access.revokeAgentKey(forever.id);
  assert.equal((await request('users_list', {}, forever.token)).status, 401);
  // Product sk_ keys never authenticate the admin API, and vice versa.
  const product = await apikeys.create({ userId: 'owner', title: 'Product' });
  assert.equal((await request('users_list', {}, product.key)).status, 401);
  assert.equal(await apikeys.validate(readToken), null);
  assert.equal(await apikeys.validate(product.key), 'owner');
  // An admin-type key on a human account is not an agent credential.
  const humanKey = `sa_admin_${'h'.repeat(43)}`;
  await db()
    .insert(schema.apikey)
    .values({
      id: 'human-admin-key',
      userId: 'owner',
      type: 'admin',
      title: 'Smuggled',
      keyHash: (await import('node:crypto'))
        .createHash('sha256')
        .update(humanKey)
        .digest('hex'),
      keyPrefix: humanKey.slice(0, 17),
      status: 'active',
    });
  assert.equal((await request('users_list', {}, humanKey)).status, 401);
  // Agents cannot mint keys: credential admin needs a browser session.
  const response = await (
    keysRoute.options.server!.handlers as {
      POST: (context: { request: Request }) => Promise<Response>;
    }
  ).POST({
    request: new Request(`${baseUrl}/api/admin/agent/keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fullToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId: fullAgentId,
        name: 'x',
        expiresAt: null,
      }),
    }),
  });
  assert.equal(response.status, 403);
  // Deleting an agent kills its keys.
  const doomed = await access.createAgent({
    name: 'Doomed',
    roleIds: ['viewer-role'],
    operatorPermissions: ['*'],
  });
  const doomedKey = await access.createAgentKey({
    agentId: doomed.id,
    name: 'Doomed',
    expiresAt: null,
  });
  assert.equal((await request('users_list', {}, doomedKey.token)).status, 200);
  await access.deleteAgent(doomed.id);
  assert.equal((await request('users_list', {}, doomedKey.token)).status, 401);
});
test('analytics_report computes period metrics and the previous-period comparison', async () => {
  const at = (iso: string) => new Date(iso);
  // Current window W = Jan 10, previous P = Jan 9 (UTC).
  await db()
    .insert(schema.user)
    .values([
      {
        id: 'r-u1',
        name: 'u1',
        email: 'r1@example.test',
        createdAt: at('2026-01-10T03:00:00Z'),
      },
      {
        id: 'r-u2',
        name: 'u2',
        email: 'r2@example.test',
        createdAt: at('2026-01-10T05:00:00Z'),
      },
      {
        id: 'r-u3',
        name: 'u3',
        email: 'r3@example.test',
        createdAt: at('2026-01-09T05:00:00Z'),
      },
      // Agents are not sign-ups.
      {
        id: 'r-bot',
        name: 'bot',
        email: 'r-bot@agent.invalid',
        type: 'api',
        createdAt: at('2026-01-10T06:00:00Z'),
      },
    ]);
  const o = (
    id: string,
    userId: string,
    status: string,
    amount: number,
    createdAt: string,
    extra: Record<string, unknown> = {}
  ) => ({
    id,
    orderNo: id,
    userId,
    status,
    amount,
    currency: 'usd',
    paymentProvider: 'stripe',
    checkoutInfo: '{}',
    paymentType: 'one-time',
    createdAt: at(createdAt),
    ...extra,
  });
  await db()
    .insert(schema.order)
    .values([
      // W: u1 first purchase; u2 abandons checkout.
      o('r-o1', 'r-u1', 'paid', 1000, '2026-01-10T04:00:00Z', {
        paidAt: at('2026-01-10T04:05:00Z'),
      }),
      o('r-o2', 'r-u2', 'created', 1000, '2026-01-10T06:00:00Z'),
      // P: u3 buys twice; one is refunded during W.
      o('r-o3', 'r-u3', 'paid', 500, '2026-01-09T06:00:00Z', {
        paidAt: at('2026-01-09T06:01:00Z'),
      }),
      o('r-o6', 'r-u3', 'refunded', 2000, '2026-01-09T07:00:00Z', {
        paidAt: at('2026-01-09T07:01:00Z'),
        refundAmount: 2000,
        refundedAt: at('2026-01-10T09:00:00Z'),
      }),
      // W: u3 renewal (paid, not a checkout, not a first-time payer).
      o('r-o4', 'r-u3', 'paid', 500, '2026-01-10T08:00:00Z', {
        paymentType: 'renew',
        paidAt: at('2026-01-10T08:00:00Z'),
      }),
    ]);
  const response = await request('analytics_report', {
    from: '2026-01-10T00:00:00Z',
    to: '2026-01-11T00:00:00Z',
  });
  assert.equal(response.status, 200);
  const { current, previous } = (await response.json()).data;
  assert.equal(current.users.new, 2);
  assert.deepEqual(current.checkout, { users: 2, orders: 2 });
  assert.deepEqual(
    { ...current.payments, revenue: undefined },
    {
      orders: 2,
      newPurchases: 1,
      renewals: 1,
      payingUsers: 2,
      firstTimePayers: 1,
      revenue: undefined,
    }
  );
  assert.deepEqual(current.payments.revenue, [
    { currency: 'usd', gross: 1500, refunded: 2000, net: -500 },
  ]);
  assert.deepEqual(current.rates, { checkoutToPaid: 0.5, signupToPaid: 0.5 });
  assert.equal(previous.users.new, 1);
  assert.deepEqual(previous.checkout, { users: 1, orders: 2 });
  assert.equal(previous.payments.orders, 2);
  assert.equal(previous.payments.firstTimePayers, 1);
  assert.deepEqual(previous.payments.revenue, [
    { currency: 'usd', gross: 2500, refunded: 0, net: 2500 },
  ]);
  assert.deepEqual(previous.rates, { checkoutToPaid: 1, signupToPaid: 1 });
  // compare=false (boolean, as MCP clients send it) skips the previous period.
  const solo = await request('analytics_report', {
    from: '2026-01-10T00:00:00Z',
    to: '2026-01-11T00:00:00Z',
    compare: false,
  });
  assert.equal((await solo.json()).data.previous, null);
  // Bad windows and missing permission are rejected.
  const reversed = await request('analytics_report', {
    from: '2026-01-11T00:00:00Z',
    to: '2026-01-10T00:00:00Z',
  });
  assert.notEqual((await reversed.json()).code, 0);
  const tooLong = await request('analytics_report', {
    from: '2025-01-01T00:00:00Z',
    to: '2026-01-01T00:00:00Z',
  });
  assert.notEqual((await tooLong.json()).code, 0);
  assert.equal((await request('analytics_report', {}, readToken)).status, 403);
});
test('machine writes require idempotency, replay once, reject changed input, and survive concurrent retries', async () => {
  const input = { userId: 'target', action: 'grant', credits: 17 };
  assert.equal((await request('credits_adjust', input)).status, 400);
  const [first, second] = await Promise.all([
    request('credits_adjust', input, fullToken, 'grant-once-test'),
    request('credits_adjust', input, fullToken, 'grant-once-test'),
  ]);
  assert.equal(first.status, 200);
  assert([200, 409].includes(second.status));
  assert.equal(await getBalance('target'), 17);
  const replay = await request(
    'credits_adjust',
    input,
    fullToken,
    'grant-once-test'
  );
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
  assert.equal((await replay.json()).data.balance, 17);
  assert.equal(
    (
      await request(
        'credits_adjust',
        { ...input, credits: 99 },
        fullToken,
        'grant-once-test'
      )
    ).status,
    409
  );
  assert.equal(await getBalance('target'), 17);
  const deduct = await request(
    'credits_adjust',
    { ...input, action: 'deduct', credits: 2 },
    fullToken,
    'deduct-once-test'
  );
  assert.equal(deduct.status, 200);
  assert.equal(await getBalance('target'), 15);
});
test('input failures do not mutate data; dispatcher cannot bypass scopes', async () => {
  assert.equal((await request('users_list', { page: 'NaN' })).status, 400);
  assert.equal(
    (
      await request(
        'credits_adjust',
        { userId: 'target', action: 'grant', credits: -1 },
        fullToken,
        'bad-amount-test'
      )
    ).status,
    400
  );
  assert.equal(
    (
      await request(
        'credits_adjust',
        { userId: 'target', action: 'grant', credits: 1, admin: true },
        fullToken,
        'bad-fields-test'
      )
    ).status,
    400
  );
  const response = await (
    executeRoute.options.server!.handlers as {
      POST: (context: { request: Request }) => Promise<Response>;
    }
  ).POST({
    request: new Request(`${baseUrl}/api/admin/agent/execute`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation: 'credits_adjust',
        input: { userId: 'target', action: 'grant', credits: 5 },
        idempotencyKey: 'no-bypass-test',
      }),
    }),
  });
  assert.equal(response.status, 403);
  assert.equal(await getBalance('target'), 15);
});
test('post create/read/update/delete works through the common REST boundary', async () => {
  const created = await request(
    'posts_create',
    {
      slug: 'test-post',
      title: 'Test',
      content: 'Draft text',
      status: 'draft',
    },
    fullToken,
    'post-create-test'
  );
  assert.equal(created.status, 200);
  const id = (await created.json()).data.id;
  assert.equal(
    (
      await request(
        'posts_update',
        { id, title: 'Updated' },
        fullToken,
        'post-update-test'
      )
    ).status,
    200
  );
  assert.equal(
    (await (await request('posts_list', { id })).json()).data.title,
    'Updated'
  );
  assert.equal(
    (await request('posts_delete', { id }, fullToken, 'post-delete-test'))
      .status,
    200
  );
});
test('configuration secrets are masked and audit never exposes payloads or raw credentials', async () => {
  const secret = 'test-only-secret-value';
  assert.equal(
    (
      await request(
        'settings_update',
        { stripe_secret_key: secret },
        fullToken,
        'settings-test-key'
      )
    ).status,
    200
  );
  const body = await (await request('settings_get', {})).text();
  assert(!body.includes(secret));
  const { items: audit, total } = await access.listExecutions({
    userId: fullAgentId,
    pageSize: 100,
  });
  assert(total >= audit.length);
  // Agent-key calls are tagged with the key; filtering keeps only those.
  const agentCalls = await access.listExecutions({
    agentsOnly: true,
    pageSize: 100,
  });
  assert(agentCalls.items.every((e: { tokenId: string | null }) => e.tokenId));
  assert(
    agentCalls.items.some(
      (e: { userName: string | null; keyName: string | null }) =>
        e.userName === 'Full agent' && e.keyName === 'Test'
    )
  );
  assert(
    audit.some(
      (entry: { operation: string }) => entry.operation === 'credits_adjust'
    )
  );
  assert(!JSON.stringify(audit).includes(secret));
  assert(!JSON.stringify(audit).includes(fullToken));
  assert(!('response' in audit[0]));
});
test('remote MCP lists scoped tools, executes a tool, and rejects missing token / foreign origin', async () => {
  assert.equal(
    (
      await handleAdminMcp(
        new Request(`${baseUrl}/api/admin/agent/mcp`, { method: 'POST' })
      )
    ).status,
    401
  );
  assert.equal(
    (
      await handleAdminMcp(
        new Request(`${baseUrl}/api/admin/agent/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${readToken}`,
            Origin: 'https://untrusted.example',
          },
        })
      )
    ).status,
    403
  );
  const client = new Client({ name: 'admin-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/api/admin/agent/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${readToken}` } } }
    )
  );
  try {
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['users_list', 'users_sources', 'users_get', 'users_timeline']
    );
    const result = await client.callTool({
      name: 'users_list',
      arguments: { input: { search: 'target@example.test' } },
    });
    assert.equal(result.isError, false);
    assert.equal(
      (result.structuredContent as { data: { total: number } }).data.total,
      1
    );
  } finally {
    await client.close();
  }
});
test('stdio MCP and standalone skill client use the published API contract', async () => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'scripts/admin-mcp.ts'],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH!,
      SHIPANY_ADMIN_URL: baseUrl,
      SHIPANY_ADMIN_TOKEN: readToken,
    },
    stderr: 'pipe',
  });
  await client.connect(transport);
  try {
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['users_list', 'users_sources', 'users_get', 'users_timeline']
    );
    const result = await client.callTool({
      name: 'users_list',
      arguments: { input: {} },
    });
    assert.equal(result.isError, false);
  } finally {
    await client.close();
  }
  const { adminConnection, adminRequest } =
    await import('../.claude/skills/shipany-admin/scripts/admin-client.mjs');
  assert.throws(() =>
    adminConnection({
      SHIPANY_ADMIN_URL: 'http://remote.example',
      SHIPANY_ADMIN_TOKEN: 'hidden',
    })
  );
  const result = await adminRequest('/api/admin/agent/operations', undefined, {
    baseUrl,
    token: readToken,
  });
  assert.equal(result.result.data.length, 4);
});
test('skill client manages several projects in a private store and never prints keys', async () => {
  const client =
    await import('../.claude/skills/shipany-admin/scripts/admin-client.mjs');
  const configFile = join(directory, 'projects', 'p.json');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHIPANY_ADMIN_CONFIG: configFile,
  };
  delete env.SHIPANY_ADMIN_URL;
  delete env.SHIPANY_ADMIN_TOKEN;
  delete env.SHIPANY_ADMIN_PROJECT;
  // A key the site rejects is never saved.
  await assert.rejects(
    client.addProject('bad', baseUrl, `sa_admin_${'x'.repeat(43)}`, env),
    /rejected/
  );
  assert.deepEqual((await client.readStore(env)).projects, {});
  await client.addProject('alpha', baseUrl, readToken, env);
  await client.addProject('beta', baseUrl, fullToken, env);
  assert.equal((await stat(configFile)).mode & 0o777, 0o600);
  // First project becomes the default; --project selects another.
  assert.equal((await client.resolveConnection({ env })).project, 'alpha');
  const beta = await client.resolveConnection({ project: 'beta', env });
  assert.equal(beta.token, fullToken);
  const ops = await client.adminRequest(
    '/api/admin/agent/operations',
    undefined,
    beta
  );
  assert.equal(ops.result.data.length, adminOperations.length);
  await assert.rejects(
    client.resolveConnection({ project: 'nope', env }),
    /Unknown project/
  );
  // Without a default and with several projects, the caller must choose.
  const store = await client.readStore(env);
  await (
    await import('node:fs/promises')
  ).writeFile(configFile, JSON.stringify({ projects: store.projects }));
  await assert.rejects(client.resolveConnection({ env }), /Several projects/);
  // The single-site env pair still works and wins when no project is named.
  const viaEnv = await client.resolveConnection({
    env: { ...env, SHIPANY_ADMIN_URL: baseUrl, SHIPANY_ADMIN_TOKEN: readToken },
  });
  assert.equal(viaEnv.token, readToken);
  // CLI: key on stdin, masked everywhere in output. Spawned asynchronously:
  // the API server runs in this process and must keep serving meanwhile.
  const run = (args: string[], input?: string) =>
    new Promise<string>((done, fail) => {
      const child = spawn(
        process.execPath,
        ['.claude/skills/shipany-admin/scripts/admin-client.mjs', ...args],
        { env }
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) =>
        code === 0 ? done(out) : fail(new Error(`exit ${code}: ${err}`))
      );
      child.stdin.end(input ?? '');
    });
  const added = await run(['add', 'gamma', baseUrl], readToken);
  const listed = await run(['projects']);
  const called = await run(['--project', 'gamma', 'list']);
  for (const out of [added, listed, called]) {
    assert(!out.includes(readToken) && !out.includes(fullToken));
  }
  assert.equal(JSON.parse(listed).length, 3);
  assert.equal(JSON.parse(called).data.length, 4);
  await run(['remove', 'gamma']);
  assert.equal(JSON.parse(await run(['projects'])).length, 2);
});
test('credential CLI creates agents, writes a private key file and never prints the key', async () => {
  const cli = (...args: string[]) =>
    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/admin-token.ts', ...args],
      { env: process.env, encoding: 'utf8' }
    );
  const agent = JSON.parse(
    cli('create-agent', '--name=CLI agent', '--roles=viewer-test')
  );
  assert.deepEqual(agent.roles, ['viewer-test']);
  const file = join(directory, 'agent-token');
  const output = cli(
    'create',
    `--agent=${agent.id}`,
    '--name=Agent test',
    `--output=${file}`
  );
  const token = await readFile(file, 'utf8');
  assert(token.startsWith('sa_admin_'));
  assert(!output.includes(token));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await request('users_list', {}, token)).status, 200);
});

test('browser sessions still read and write, while foreign origins and bad bearer headers are rejected', async () => {
  await db()
    .insert(schema.account)
    .values({
      id: 'owner-password',
      accountId: 'owner',
      userId: 'owner',
      providerId: 'credential',
      password: await hashPassword('test-password-strong-123'),
    });
  const signedIn = await getAuth().api.signInEmail({
    body: { email: 'owner@example.test', password: 'test-password-strong-123' },
    asResponse: true,
    headers: new Headers({ Origin: 'http://localhost:3000' }),
  });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value: string) => value.split(';')[0])
    .join('; ');
  assert(cookie);
  const read = await runAdminRoute('users_list', {
    request: new Request('http://localhost:3000/api/admin/users', {
      headers: { Cookie: cookie },
    }),
  });
  assert.equal(read.status, 200);
  const write = (origin: string, authorization?: string) =>
    runAdminRoute('roles_create', {
      request: new Request('http://localhost:3000/api/admin/roles', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({ name: 'browser-role', title: 'Browser role' }),
      }),
    });
  assert.equal((await write('https://foreign.example')).status, 403);
  assert.equal(
    (await write('http://localhost:3000', 'Bearer invalid')).status,
    401
  );
  assert.equal((await write('http://localhost:3000')).status, 200);
});
test('legacy MCP clients can initialize and list tools on the stateless HTTP endpoint', async () => {
  async function rpc(body: unknown) {
    const response = await fetch(`${baseUrl}/api/admin/agent/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    return JSON.parse(
      text.startsWith('event:') || text.startsWith('data:')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data:'))!
            .slice(5)
        : text
    );
  }
  const init = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'legacy-test', version: '1.0.0' },
    },
  });
  assert.equal(init.result.protocolVersion, '2025-11-25');
  // The server says which site it administers (several can be connected).
  assert.match(init.result.instructions, /^Admin API of ".+" \(http/);
  const tools = await rpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  assert(
    tools.result.tools.some(
      (tool: { name: string }) => tool.name === 'users_list'
    )
  );
});
