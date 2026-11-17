import { and, count, eq, max, sum } from 'drizzle-orm';

import { db } from '@/core/db';
import { credit, order, user } from '@/config/db/schema';
import { getBalance } from '@/modules/credits/service';
import { getUserRoles } from '@/modules/rbac/service';
import { respData, respErr } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

// User detail: profile + sign-up attribution + order/credit totals. The order
// and credit records themselves come from orders_list / credits_list (?userId=).
export async function GET({ params }: AdminHandlerContext) {
  try {
    const { id } = params;
    const [profile] = await db()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
        utmSource: user.utmSource,
        utmMedium: user.utmMedium,
        utmCampaign: user.utmCampaign,
        utmTerm: user.utmTerm,
        utmContent: user.utmContent,
        referrer: user.referrer,
        ip: user.ip,
        country: user.country,
        locale: user.locale,
      })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    if (!profile) return respErr('User not found', { status: 404 });

    const [roles, balance, orderTotals, paidByCurrency, creditTotals] =
      await Promise.all([
        getUserRoles(id),
        getBalance(id),
        db()
          .select({ total: count(), lastOrderAt: max(order.createdAt) })
          .from(order)
          .where(eq(order.userId, id)),
        db()
          .select({
            currency: order.currency,
            orders: count(),
            amount: sum(order.amount),
          })
          .from(order)
          .where(and(eq(order.userId, id), eq(order.status, 'paid')))
          .groupBy(order.currency),
        db()
          .select({
            transactionType: credit.transactionType,
            credits: sum(credit.credits),
          })
          .from(credit)
          .where(and(eq(credit.userId, id), eq(credit.status, 'active')))
          .groupBy(credit.transactionType),
      ]);

    const creditSum = (type: string) =>
      Math.abs(
        Number(
          creditTotals.find(
            (r: (typeof creditTotals)[number]) => r.transactionType === type
          )?.credits ?? 0
        )
      );

    return respData({
      user: profile,
      roles,
      stats: {
        creditBalance: balance,
        creditsGranted: creditSum('grant'),
        creditsConsumed: creditSum('consume'),
        orderCount: orderTotals[0]?.total ?? 0,
        lastOrderAt: orderTotals[0]?.lastOrderAt ?? null,
        paidOrderCount: paidByCurrency.reduce(
          (n: number, r: (typeof paidByCurrency)[number]) => n + r.orders,
          0
        ),
        paidAmounts: paidByCurrency.map(
          (r: (typeof paidByCurrency)[number]) => ({
            currency: r.currency,
            amount: Number(r.amount ?? 0),
          })
        ),
      },
    });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
