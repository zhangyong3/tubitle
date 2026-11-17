import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';

import { affectedRows, db } from '@/core/db';
import { order, user } from '@/config/db/schema';
import { respErr, respOk, respPage } from '@/lib/resp';
import { keywordMatch } from '@/lib/sql-search';

import type { AdminHandlerContext } from '../types';

/**
 * The only status edit allowed by hand: closing an order that was never paid.
 * Money states (paid, refunding, refunded) only change through the payment
 * flows — moving a paid order back to pending would let the provider's next
 * notification settle it, and grant its credits, a second time.
 */
const CLOSABLE_STATUSES = ['created', 'pending'];
const CLOSED_STATUS = 'failed';

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
    const paymentType = searchParams.get('paymentType');
    const search = searchParams.get('search');
    const userId = searchParams.get('userId');

    const conditions: SQL[] = [];
    if (userId) conditions.push(eq(order.userId, userId));
    if (status) conditions.push(eq(order.status, status));
    if (paymentType) conditions.push(eq(order.paymentType, paymentType));
    const keyword = keywordMatch(search, {
      contains: [
        order.orderNo,
        order.userEmail,
        order.paymentEmail,
        user.email,
        user.name,
      ],
      exact: [
        order.userId,
        order.transactionId,
        order.paymentSessionId,
        order.subscriptionId,
      ],
    });
    if (keyword) conditions.push(keyword);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db()
      .select({ count: count() })
      .from(order)
      .leftJoin(user, eq(order.userId, user.id))
      .where(where);
    const total = totalResult.count;

    const orders = await db()
      .select({
        id: order.id,
        orderNo: order.orderNo,
        userId: order.userId,
        userEmail: order.userEmail,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        paymentType: order.paymentType,
        paymentProvider: order.paymentProvider,
        productId: order.productId,
        productName: order.productName,
        description: order.description,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        paymentAmount: order.paymentAmount,
        creditsAmount: order.creditsAmount,
        subscriptionNo: order.subscriptionNo,
        refundAmount: order.refundAmount,
        refundedAt: order.refundedAt,
        userName: user.name,
        userImage: user.image,
        userAccountEmail: user.email,
      })
      .from(order)
      .leftJoin(user, eq(order.userId, user.id))
      .where(where)
      .orderBy(desc(order.createdAt))
      .limit(pageSize)
      .offset(offset);

    return respPage(orders, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function PATCH({ request, actor }: AdminHandlerContext) {
  try {
    const { orderNo, status, productId, productName, description } =
      await request.json();
    if (!orderNo) return respErr('orderNo is required');
    const [current] = await db()
      .select({ status: order.status })
      .from(order)
      .where(eq(order.orderNo, orderNo))
      .limit(1);
    if (!current) return respErr('Order not found');
    // The edit form always sends the current status; only a real change is checked.
    const statusChange =
      status !== undefined && status !== '' && status !== current.status;
    if (
      statusChange &&
      !(status === CLOSED_STATUS && CLOSABLE_STATUSES.includes(current.status))
    )
      return respErr(
        'Only an unpaid (created/pending) order can be closed as failed; payment states change through checkout and refunds'
      );

    const patch: Record<string, unknown> = {};
    if (statusChange) patch.status = status;
    if (productId !== undefined) patch.productId = productId;
    if (productName !== undefined) patch.productName = productName;
    if (description !== undefined) patch.description = description;
    if (Object.keys(patch).length === 0) return respErr('No fields to update');

    if (statusChange) {
      // Conditional: a webhook may settle the order between the read and here.
      const result = await db()
        .update(order)
        .set(patch)
        .where(
          and(
            eq(order.orderNo, orderNo),
            inArray(order.status, CLOSABLE_STATUSES)
          )
        );
      if (affectedRows(result) === 0)
        return respErr('Order status changed; reload and retry');
      return respOk();
    }
    await db().update(order).set(patch).where(eq(order.orderNo, orderNo));
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
