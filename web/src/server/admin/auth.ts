import { getAuth } from '@/core/auth';
import { matchPermission } from '@/core/auth/rbac';
import { validateAdminKey } from '@/modules/admin-access/service';
import { getUserPermissionCodes } from '@/modules/rbac/service';

import { AdminError, type AdminActor } from './types';

export async function authenticateAdmin(request: Request): Promise<AdminActor> {
  // Never fall back to a cookie if an invalid Authorization header was supplied.
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const match = /^Bearer (\S+)$/i.exec(authorization);
    // Agent API key → that agent account; its RBAC roles are its permissions.
    const token = match ? await validateAdminKey(match[1]) : null;
    if (!token) throw new AdminError('Invalid or expired admin API key', 401);
    return {
      ...token,
      permissions: await getUserPermissionCodes(token.userId),
    };
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) throw new AdminError('Unauthorized', 401);
  return {
    userId: session.user.id,
    permissions: await getUserPermissionCodes(session.user.id),
  };
}
export function canOperate(actor: AdminActor, permission: string) {
  return matchPermission(permission, actor.permissions);
}
export function requirePermission(actor: AdminActor, permission: string) {
  if (!canOperate(actor, permission)) throw new AdminError('Forbidden', 403);
}
export function checkSessionOrigin(request: Request, actor: AdminActor) {
  if (actor.tokenId || ['GET', 'HEAD'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    throw new AdminError('Same-origin request required', 403);
}
