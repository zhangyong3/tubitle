import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import { db } from '@/core/db';
import { subscription } from '@/config/db/schema';
import { PRO_PRODUCT_IDS } from '@/config/learning-plans';

export async function activeProSubscription(userId: string, now = new Date()) {
  const [paid] = await db()
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.userId, userId),
        isNull(subscription.deletedAt),
        inArray(subscription.productId, PRO_PRODUCT_IDS),
        inArray(subscription.status, ['active', 'pending_cancel', 'trialing']),
        gt(subscription.currentPeriodEnd, now),
        or(
          isNull(subscription.currentPeriodStart),
          lte(subscription.currentPeriodStart, now)
        )
      )
    )
    .limit(1);
  return paid ?? null;
}

export async function planFor(
  userId: string,
  now = new Date()
): Promise<'free' | 'pro'> {
  return (await activeProSubscription(userId, now)) ? 'pro' : 'free';
}
