import { and, count, desc, eq, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import { credit, user } from '@/config/db/schema';
import { respErr, respPage } from '@/lib/resp';
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

    const transactionType = searchParams.get('transactionType');
    const status = searchParams.get('status');

    const search = searchParams.get('search');
    const userId = searchParams.get('userId');

    const conditions: SQL[] = [];
    if (userId) conditions.push(eq(credit.userId, userId));
    if (transactionType)
      conditions.push(eq(credit.transactionType, transactionType));
    // Defaults to active records; status=all lifts the filter.
    if (!status) conditions.push(eq(credit.status, 'active'));
    else if (status !== 'all') conditions.push(eq(credit.status, status));
    const keyword = keywordMatch(search, {
      contains: [
        credit.transactionNo,
        credit.orderNo,
        credit.userEmail,
        user.email,
        user.name,
      ],
      exact: [credit.userId],
    });
    if (keyword) conditions.push(keyword);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db()
      .select({ count: count() })
      .from(credit)
      .leftJoin(user, eq(user.id, credit.userId))
      .where(where);
    const total = totalResult.count;

    const rows = await db()
      .select({
        id: credit.id,
        userId: credit.userId,
        userEmail: credit.userEmail,
        userTableEmail: user.email,
        userName: user.name,
        userImage: user.image,
        transactionNo: credit.transactionNo,
        transactionType: credit.transactionType,
        transactionScene: credit.transactionScene,
        credits: credit.credits,
        remainingCredits: credit.remainingCredits,
        description: credit.description,
        expiresAt: credit.expiresAt,
        status: credit.status,
        createdAt: credit.createdAt,
      })
      .from(credit)
      .leftJoin(user, eq(user.id, credit.userId))
      .where(where)
      .orderBy(desc(credit.createdAt))
      .limit(pageSize)
      .offset(offset);

    const credits = rows.map((r: (typeof rows)[number]) => {
      const { userTableEmail, ...rest } = r;
      return { ...rest, userEmail: rest.userEmail || userTableEmail || null };
    });

    return respPage(credits, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
