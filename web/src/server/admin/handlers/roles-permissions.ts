import {
  assignPermissionsToRole,
  getRolePermissions,
} from '@/modules/rbac/service';
import { respData, respErr, respOk } from '@/lib/resp';

import { beyondCeiling, permissionCodes, roleCodes } from '../ceiling';
import type { AdminHandlerContext } from '../types';

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const roleId = searchParams.get('roleId');
    if (!roleId) return respErr('roleId is required');
    const perms = await getRolePermissions(roleId);
    return respData(perms);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function PUT({ request, actor }: AdminHandlerContext) {
  try {
    const { roleId, permissionIds } = await request.json();
    if (!roleId) return respErr('roleId is required');
    // Both what the role had (removing it) and what it gets (granting it)
    // must sit within the caller's own permissions.
    const denied = beyondCeiling(actor, [
      ...(await roleCodes([roleId])),
      ...(await permissionCodes(permissionIds || [])),
    ]);
    if (denied) return denied;
    await assignPermissionsToRole(roleId, permissionIds || []);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
