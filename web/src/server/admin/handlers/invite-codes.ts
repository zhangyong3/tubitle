import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import { inviteCode, user, userInvite } from '@/config/db/schema';
import {
  createInviteCode,
  createInviteCodesBatch,
  deleteInviteCode,
} from '@/modules/invite-codes/service';
import { respData, respErr, respOk, respPage } from '@/lib/resp';
import { keywordMatch } from '@/lib/sql-search';

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
    const status = searchParams.get('status'); // 'available' | 'used'

    const conditions: SQL[] = [];
    const keyword = keywordMatch(search, {
      contains: [inviteCode.code, inviteCode.note],
    });
    if (keyword) {
      // Also match codes redeemed by a user with that email / name / id.
      const redeemedBy = keywordMatch(search, {
        contains: [user.email, user.name],
        exact: [user.id],
      })!;
      conditions.push(
        or(
          keyword,
          inArray(
            inviteCode.id,
            db()
              .select({ id: userInvite.inviteCodeId })
              .from(userInvite)
              .innerJoin(user, eq(user.id, userInvite.userId))
              .where(redeemedBy)
          )
        )!
      );
    }
    if (status === 'available') {
      conditions.push(sql`${inviteCode.usedCount} < ${inviteCode.maxUses}`);
      conditions.push(
        or(
          sql`${inviteCode.expiresAt} IS NULL`,
          gte(inviteCode.expiresAt, new Date())
        )!
      );
    } else if (status === 'used') {
      conditions.push(sql`${inviteCode.usedCount} >= ${inviteCode.maxUses}`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db()
      .select({ count: count() })
      .from(inviteCode)
      .where(where);
    const total = totalResult.count;

    const rows = await db()
      .select()
      .from(inviteCode)
      .where(where)
      .orderBy(desc(inviteCode.createdAt))
      .limit(pageSize)
      .offset(offset);

    return respPage(rows, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST({ request, actor }: AdminHandlerContext) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      code,
      count: batchCount,
      maxUses,
      trialDays,
      note,
      expiresAt,
    } = body as {
      code?: string;
      count?: number;
      maxUses?: number;
      trialDays?: number;
      note?: string;
      expiresAt?: string | null;
    };

    const expires = expiresAt ? new Date(expiresAt) : null;
    const params = {
      maxUses: typeof maxUses === 'number' ? maxUses : undefined,
      trialDays: typeof trialDays === 'number' ? trialDays : undefined,
      note,
      createdBy: actor.userId,
      expiresAt: expires,
    };

    if (typeof batchCount === 'number' && batchCount > 1) {
      const limited = Math.min(100, Math.max(1, batchCount));
      const rows = await createInviteCodesBatch({ ...params, count: limited });
      return respData(rows);
    }

    const row = await createInviteCode({ code, ...params });
    return respData(row);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function DELETE({ request, actor }: AdminHandlerContext) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return respErr('ID is required');
    await deleteInviteCode(id);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
