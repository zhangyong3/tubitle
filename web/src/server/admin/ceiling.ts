import { eq, inArray } from 'drizzle-orm';

import { matchPermission } from '@/core/auth/rbac';
import { db } from '@/core/db';
import { permission, rolePermission } from '@/config/db/schema';
import { respErr } from '@/lib/resp';

import type { AdminActor } from './types';

/**
 * Privilege ceiling for RBAC writes: an actor (admin or agent) may only grant,
 * revoke or reshape permissions it already holds. Without this, anyone with
 * `roles.write` could assign themselves super_admin, or attach `*` to a role
 * they have.
 */

export async function roleCodes(roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const rows: { code: string }[] = await db()
    .select({ code: permission.code })
    .from(rolePermission)
    .innerJoin(permission, eq(rolePermission.permissionId, permission.id))
    .where(inArray(rolePermission.roleId, roleIds));
  return rows.map((r) => r.code);
}

export async function permissionCodes(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows: { code: string }[] = await db()
    .select({ code: permission.code })
    .from(permission)
    .where(inArray(permission.id, ids));
  return rows.map((r) => r.code);
}

/** A 403 response when any code exceeds the actor's permissions, else null. */
export function beyondCeiling(actor: AdminActor, codes: string[]) {
  const exceeding = codes.find((c) => !matchPermission(c, actor.permissions));
  return exceeding
    ? respErr(
        `Not allowed: this involves ${exceeding}, which you do not have`,
        {
          status: 403,
        }
      )
    : null;
}
