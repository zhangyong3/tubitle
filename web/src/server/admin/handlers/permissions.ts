import { and, count, like, or, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import { permission } from '@/config/db/schema';
import {
  createPermission,
  deletePermission,
  updatePermission,
} from '@/modules/rbac/service';
import { respData, respErr, respOk, respPage } from '@/lib/resp';

import { beyondCeiling, permissionCodes } from '../ceiling';
import type { AdminHandlerContext } from '../types';

export async function GET({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const offset = (page - 1) * pageSize;
    const search = searchParams.get('search');

    const conditions: SQL[] = [];
    if (search) {
      conditions.push(
        or(
          like(permission.code, `%${search}%`),
          like(permission.title, `%${search}%`)
        )!
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db()
      .select({ count: count() })
      .from(permission)
      .where(where);
    const total = totalResult.count;

    const permissions = await db()
      .select()
      .from(permission)
      .where(where)
      .limit(pageSize)
      .offset(offset);

    return respPage(permissions, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const { code, resource, action, title } = await request.json();
    if (!code || !resource || !action || !title) {
      return respErr('code, resource, action, and title are required');
    }
    // Defining e.g. a `*` permission is only for those who already hold it.
    const denied = beyondCeiling(actor, [String(code)]);
    if (denied) return denied;
    const result = await createPermission({ code, resource, action, title });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function PUT({ request, actor }: AdminHandlerContext) {
  try {
    const { id, code, resource, action, title, description } =
      await request.json();
    if (!id) return respErr('ID is required');
    // Renaming a code changes what every role holding it grants: both the old
    // and the new code must be within the caller's permissions.
    const denied = beyondCeiling(actor, [
      ...(await permissionCodes([id])),
      ...(code ? [String(code)] : []),
    ]);
    if (denied) return denied;
    const result = await updatePermission(id, {
      code,
      resource,
      action,
      title,
      description,
    });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function DELETE({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return respErr('ID is required');
    const denied = beyondCeiling(actor, await permissionCodes([id]));
    if (denied) return denied;
    await deletePermission(id);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
