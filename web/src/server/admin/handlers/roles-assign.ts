import { assignRoleToUser, removeRoleFromUser } from '@/modules/rbac/service';
import { respErr, respOk } from '@/lib/resp';

import { beyondCeiling, roleCodes } from '../ceiling';
import type { AdminHandlerContext } from '../types';

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const { userId, roleId } = await request.json();
    if (!userId || !roleId) return respErr('userId and roleId are required');
    // Never hand out a role carrying more than the caller has.
    const denied = beyondCeiling(actor, await roleCodes([roleId]));
    if (denied) return denied;

    await assignRoleToUser(userId, roleId);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function DELETE({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const roleId = searchParams.get('roleId');
    if (!userId || !roleId) return respErr('userId and roleId are required');
    // Nor strip someone of a role above the caller (e.g. demote super_admin).
    const denied = beyondCeiling(actor, await roleCodes([roleId]));
    if (denied) return denied;

    await removeRoleFromUser(userId, roleId);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
