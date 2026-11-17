import { and, count, desc, eq, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import { subscription, user } from '@/config/db/schema';
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

    const status = searchParams.get('status');
    const interval = searchParams.get('interval');

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(subscription.status, status));
    if (interval) conditions.push(eq(subscription.interval, interval));
    const keyword = keywordMatch(searchParams.get('search'), {
      contains: [
        subscription.subscriptionNo,
        subscription.userEmail,
        user.email,
        user.name,
      ],
      exact: [subscription.userId, subscription.subscriptionId],
    });
    if (keyword) conditions.push(keyword);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db()
      .select({ count: count() })
      .from(subscription)
      .leftJoin(user, eq(user.id, subscription.userId))
      .where(where);
    const total = totalResult.count;

    const subscriptions = await db()
      .select({
        id: subscription.id,
        subscriptionNo: subscription.subscriptionNo,
        userId: subscription.userId,
        userEmail: subscription.userEmail,
        status: subscription.status,
        amount: subscription.amount,
        currency: subscription.currency,
        interval: subscription.interval,
        paymentProvider: subscription.paymentProvider,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        description: subscription.description,
        createdAt: subscription.createdAt,
        userName: user.name,
        userImage: user.image,
        userAccountEmail: user.email,
      })
      .from(subscription)
      .leftJoin(user, eq(user.id, subscription.userId))
      .where(where)
      .orderBy(desc(subscription.createdAt))
      .limit(pageSize)
      .offset(offset);

    return respPage(subscriptions, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
