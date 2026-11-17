import { createHash, randomBytes } from 'node:crypto';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
} from 'drizzle-orm';

import { matchPermission } from '@/core/auth/rbac';
import { db } from '@/core/db';
import {
  adminExecution,
  apikey,
  permission,
  role,
  rolePermission,
  user,
  userRole,
  type AdminExecution,
} from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

/**
 * Agents are service accounts: `user.type = 'api'` rows with no login method,
 * whose permissions come entirely from the RBAC roles assigned to them.
 * Their credentials are `apikey.type = 'admin'` rows — hash-only (the key is
 * shown once, never stored recoverably), optionally expiring, and kept
 * strictly apart from product `sk_` keys.
 */

export const USER_TYPE_API = 'api';
export const APIKEY_TYPE_ADMIN = 'admin';
const KEY_PREFIX = 'sa_admin_';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// ─── Agents ──────────────────────────────────────────────────────────────────

export class AccessError extends Error {}

/**
 * Throws unless every permission granted by `roleIds` is already held by the
 * operator — an agent can never be given more than its creator has.
 */
async function assertRolesWithin(
  roleIds: string[],
  operatorPermissions: string[]
) {
  if (!roleIds.length) return;
  const roles: { id: string }[] = await db()
    .select({ id: role.id })
    .from(role)
    .where(and(inArray(role.id, roleIds), eq(role.status, 'active')));
  if (roles.length !== new Set(roleIds).size)
    throw new AccessError('Unknown or inactive role');
  const codes: { code: string }[] = await db()
    .select({ code: permission.code })
    .from(rolePermission)
    .innerJoin(permission, eq(rolePermission.permissionId, permission.id))
    .where(inArray(rolePermission.roleId, roleIds));
  const exceeding = codes.find(
    (c) => !matchPermission(c.code, operatorPermissions)
  );
  if (exceeding)
    throw new AccessError(
      `A selected role grants ${exceeding.code}, which you do not have`
    );
}

async function setRoles(userId: string, roleIds: string[]) {
  await db().delete(userRole).where(eq(userRole.userId, userId));
  if (roleIds.length)
    await db()
      .insert(userRole)
      .values(
        [...new Set(roleIds)].map((roleId) => ({
          id: getUuid(),
          userId,
          roleId,
        }))
      );
}

export async function createAgent(input: {
  name: string;
  roleIds: string[];
  operatorPermissions: string[];
}) {
  await assertRolesWithin(input.roleIds, input.operatorPermissions);
  const id = getUuid();
  // `.invalid` is a reserved TLD: no inbox and no OAuth provider can ever
  // issue it, so the account can't be signed into or linked.
  await db()
    .insert(user)
    .values({
      id,
      name: input.name,
      email: `agent-${id}@agent.invalid`,
      emailVerified: false,
      type: USER_TYPE_API,
    });
  await setRoles(id, input.roleIds);
  return { id, name: input.name };
}

async function getAgent(id: string) {
  const [row]: { id: string }[] = await db()
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, id), eq(user.type, USER_TYPE_API)))
    .limit(1);
  if (!row) throw new AccessError('Agent not found');
  return row;
}

export async function updateAgent(input: {
  id: string;
  name?: string;
  roleIds?: string[];
  operatorPermissions: string[];
}) {
  await getAgent(input.id);
  if (input.roleIds) {
    await assertRolesWithin(input.roleIds, input.operatorPermissions);
    await setRoles(input.id, input.roleIds);
  }
  if (input.name)
    await db()
      .update(user)
      .set({ name: input.name })
      .where(eq(user.id, input.id));
}

/** Deleting the account cascades to its roles and keys. */
export async function deleteAgent(id: string) {
  await getAgent(id);
  await db().delete(user).where(eq(user.id, id));
}

export async function listAgents() {
  const agents: { id: string; name: string; createdAt: Date }[] = await db()
    .select({ id: user.id, name: user.name, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.type, USER_TYPE_API))
    .orderBy(desc(user.createdAt));
  if (!agents.length) return [];
  const ids = agents.map((a) => a.id);
  const [roles, keys] = await Promise.all([
    db()
      .select({
        userId: userRole.userId,
        id: role.id,
        name: role.name,
        title: role.title,
      })
      .from(userRole)
      .innerJoin(role, eq(userRole.roleId, role.id))
      .where(inArray(userRole.userId, ids)),
    db()
      .select({
        id: apikey.id,
        userId: apikey.userId,
        name: apikey.title,
        keyPrefix: apikey.keyPrefix,
        status: apikey.status,
        createdAt: apikey.createdAt,
        expiresAt: apikey.expiresAt,
        lastUsedAt: apikey.lastUsedAt,
      })
      .from(apikey)
      .where(
        and(inArray(apikey.userId, ids), eq(apikey.type, APIKEY_TYPE_ADMIN))
      )
      .orderBy(desc(apikey.createdAt)),
  ]);
  return agents.map((agent) => ({
    ...agent,
    roles: roles
      .filter((r: { userId: string }) => r.userId === agent.id)
      .map(
        ({
          userId: _,
          ...r
        }: {
          userId: string;
          id: string;
          name: string;
          title: string;
        }) => r
      ),
    keys: keys
      .filter((k: { userId: string }) => k.userId === agent.id)
      .map(
        ({ userId: _, ...k }: { userId: string } & Record<string, unknown>) => k
      ),
  }));
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export async function createAgentKey(input: {
  agentId: string;
  name: string;
  /** null = never expires (still revocable). */
  expiresAt: Date | null;
}) {
  await getAgent(input.agentId);
  const token = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = getUuid();
  await db()
    .insert(apikey)
    .values({
      id,
      userId: input.agentId,
      type: APIKEY_TYPE_ADMIN,
      title: input.name,
      keyHash: hash(token),
      keyPrefix: token.slice(0, 17),
      key: null, // never stored recoverably
      status: 'active',
      expiresAt: input.expiresAt,
    });
  return { id, token, name: input.name, expiresAt: input.expiresAt };
}

/** Revoke an admin key; `agentId` optionally pins it to one agent. */
export async function revokeAgentKey(id: string, agentId?: string) {
  await db()
    .update(apikey)
    .set({ status: 'revoked', deletedAt: new Date() })
    .where(
      and(
        eq(apikey.id, id),
        eq(apikey.type, APIKEY_TYPE_ADMIN),
        ...(agentId ? [eq(apikey.userId, agentId)] : [])
      )
    );
}

export async function validateAdminKey(
  token: string
): Promise<{ userId: string; tokenId: string } | null> {
  if (!/^sa_admin_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row]: { id: string; userId: string }[] = await db()
    .select({ id: apikey.id, userId: apikey.userId })
    .from(apikey)
    .innerJoin(user, eq(apikey.userId, user.id))
    .where(
      and(
        eq(apikey.keyHash, hash(token)),
        eq(apikey.type, APIKEY_TYPE_ADMIN),
        eq(apikey.status, 'active'),
        isNull(apikey.deletedAt),
        or(isNull(apikey.expiresAt), gt(apikey.expiresAt, new Date())),
        eq(user.type, USER_TYPE_API)
      )
    )
    .limit(1);
  if (!row) return null;
  await db()
    .update(apikey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apikey.id, row.id));
  return { userId: row.userId, tokenId: row.id };
}

// ─── Execution journal ───────────────────────────────────────────────────────

export async function getExecution(
  id: string
): Promise<AdminExecution | undefined> {
  const [row] = await db()
    .select()
    .from(adminExecution)
    .where(eq(adminExecution.id, id))
    .limit(1);
  return row;
}
export async function reserveExecution(
  input: typeof adminExecution.$inferInsert
) {
  await db().insert(adminExecution).values(input);
}
export async function finishExecution(
  id: string,
  status: string,
  response: string | null
) {
  await db()
    .update(adminExecution)
    .set({ status, response, completedAt: new Date() })
    .where(eq(adminExecution.id, id));
}
/**
 * Execution history, newest first. `userId` narrows to one actor (an agent);
 * `agentsOnly` keeps only calls made with an agent API key (not browser admins).
 */
export async function listExecutions({
  userId,
  agentsOnly = false,
  page = 1,
  pageSize = 20,
}: {
  userId?: string;
  agentsOnly?: boolean;
  page?: number;
  pageSize?: number;
} = {}) {
  const where = and(
    userId ? eq(adminExecution.userId, userId) : undefined,
    agentsOnly ? isNotNull(adminExecution.tokenId) : undefined
  );
  const [items, [{ total }]] = await Promise.all([
    // Replay payloads and request hashes are deliberately not exposed in the audit view.
    db()
      .select({
        id: adminExecution.id,
        userId: adminExecution.userId,
        userName: user.name,
        tokenId: adminExecution.tokenId,
        keyName: apikey.title,
        keyPrefix: apikey.keyPrefix,
        operation: adminExecution.operation,
        targetId: adminExecution.targetId,
        status: adminExecution.status,
        createdAt: adminExecution.createdAt,
        completedAt: adminExecution.completedAt,
      })
      .from(adminExecution)
      .leftJoin(user, eq(adminExecution.userId, user.id))
      .leftJoin(apikey, eq(adminExecution.tokenId, apikey.id))
      .where(where)
      .orderBy(desc(adminExecution.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db().select({ total: count() }).from(adminExecution).where(where),
  ]);
  return { items, total: Number(total) };
}
