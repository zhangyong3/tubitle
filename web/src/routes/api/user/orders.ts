import { createFileRoute } from '@tanstack/react-router';
import { and, count, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm';

import { getAuth } from '@/core/auth';
import { db } from '@/core/db';
import { guestPost, order, post } from '@/config/db/schema';
import { respErr, respPage } from '@/lib/resp';

async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    );
    const offset = (page - 1) * pageSize;

    const paymentType = searchParams.get('paymentType');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const conditions: SQL[] = [eq(order.userId, session.user.id)];
    if (paymentType) conditions.push(eq(order.paymentType, paymentType));
    if (status) conditions.push(eq(order.status, status));
    if (search) {
      conditions.push(
        or(
          like(order.orderNo, `%${search}%`),
          like(order.productName, `%${search}%`),
          like(order.planName, `%${search}%`)
        )!
      );
    }

    const where = and(...conditions);

    const [totalResult] = await db()
      .select({ count: count() })
      .from(order)
      .where(where);

    const rows = await db()
      .select({
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        paymentProvider: order.paymentProvider,
        paymentType: order.paymentType,
        productName: order.productName,
        planName: order.planName,
        invoiceUrl: order.invoiceUrl,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        reference: order.reference,
      })
      .from(order)
      .where(where)
      .orderBy(desc(order.createdAt))
      .limit(pageSize)
      .offset(offset);

    // What a reference points to, e.g. the guest post an order paid for
    // (the buyer's own only).
    const refs: (string | null)[] = rows.map(
      (r: { reference: string | null }) => r.reference
    );
    const guestIds = refs
      .filter((r): r is string => !!r?.startsWith('guest_post:'))
      .map((r) => r.slice('guest_post:'.length));
    const titles = new Map<string, string>();
    if (guestIds.length) {
      const found = await db()
        .select({ id: guestPost.id, title: post.title })
        .from(guestPost)
        .innerJoin(post, eq(post.id, guestPost.postId))
        .where(
          and(
            inArray(guestPost.id, guestIds),
            eq(guestPost.userId, session.user.id)
          )
        );
      for (const g of found as { id: string; title: string | null }[]) {
        titles.set(g.id, g.title || '');
      }
    }
    const items = rows.map(
      ({
        reference,
        ...r
      }: { reference: string | null } & Record<string, unknown>) => {
        const id = reference?.startsWith('guest_post:')
          ? reference.slice('guest_post:'.length)
          : null;
        return {
          ...r,
          guestPost:
            id && titles.has(id) ? { id, title: titles.get(id) || '' } : null,
        };
      }
    );

    return respPage(items, totalResult.count);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/user/orders')({
  server: {
    handlers: { GET },
  },
});
