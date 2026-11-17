import { and, asc, desc, eq, gte, isNotNull, lte, ne } from 'drizzle-orm';

import { db } from '@/core/db';
import {
  aiTask,
  credit,
  order,
  subscription,
  ticket,
  user,
  userEvent,
} from '@/config/db/schema';
import { respData, respErr } from '@/lib/resp';

import { customTimelineSources } from '../timeline-sources';
import type { AdminHandlerContext } from '../types';

/**
 * A user's activity timeline, assembled from the records the app already
 * keeps (sign-up, orders, subscriptions, credits, AI tasks, tickets), product
 * events in `user_event` (src/config/events.ts), and any project tables
 * plugged in through ../timeline-sources.ts.
 *
 * Order: `order=asc` (oldest first, reads as the user's journey) or `desc`
 * (default, newest first). Events sort by (at, key) in that direction.
 * Ties at the same instant follow KIND_RANK (created → paid → granted …).
 * Paging: `cursor` is the last event's `<ms>~<key>`; each source is read from
 * that time onward and the merge drops anything not strictly past the cursor.
 */

export type BuiltinTimelineKind =
  | 'signup'
  | 'order_created'
  | 'order_paid'
  | 'order_failed'
  | 'order_refunded'
  | 'subscription_started'
  | 'subscription_canceled'
  | 'credits_granted'
  | 'credits_consumed'
  | 'task_created'
  | 'task_succeeded'
  | 'task_failed'
  | 'ticket_opened';

export interface TimelineEvent {
  key: string;
  at: string;
  /** A BuiltinTimelineKind, a user_event kind, or a custom source's kind. */
  kind: string;
  /** Plain-data detail; the UI formats it. */
  detail: Record<string, string | number | boolean | null>;
  /** Admin page to open for this record, when there is one. */
  ref?: { type: 'order' | 'subscription' | 'credit' | 'ticket'; id: string };
  /** Internal admin path (custom sources). */
  href?: string;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function parseCursor(raw: string | null): { at: Date; key: string } | null {
  if (!raw) return null;
  const sep = raw.indexOf('~');
  const ms = Number(raw.slice(0, sep));
  if (sep < 0 || !Number.isFinite(ms) || ms <= 0) return null;
  return { at: new Date(ms), key: raw.slice(sep + 1) };
}

const toDate = (v: unknown) => (v instanceof Date ? v : new Date(v as any));

// Same-instant tie-break: the order things happen in one checkout.
const KIND_RANK: Record<string, number> = {
  signup: 0,
  order_created: 1,
  order_paid: 2,
  subscription_started: 3,
  credits_granted: 4,
  task_created: 5,
  credits_consumed: 6,
  task_succeeded: 7,
  task_failed: 7,
  order_failed: 8,
  order_refunded: 8,
  subscription_canceled: 9,
  ticket_opened: 10,
};
const rankOf = (key: string) => KIND_RANK[key.slice(0, key.indexOf(':'))] ?? 99;
// Provider timestamps (paid_at, refunded_at) have second precision and can
// read earlier than the order row; such events are shown no earlier than the
// order's creation. Sources are read with this much slack around the cursor
// so an adjusted event is never skipped between pages.
const SLACK_MS = 1000;

export async function GET({ request }: AdminHandlerContext) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    if (!userId) return respErr('Missing userId');
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const ascending = url.searchParams.get('order') === 'asc';
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const from = (col: any) =>
      cursor
        ? ascending
          ? gte(col, new Date(cursor.at.getTime() - SLACK_MS))
          : lte(col, new Date(cursor.at.getTime() + SLACK_MS))
        : undefined;
    const notBefore = (at: unknown, floor: unknown) =>
      at && floor && toDate(floor) > toDate(at) ? floor : at;
    const by = (col: any) => (ascending ? asc(col) : desc(col));

    const [
      [profile],
      ordersCreated,
      ordersPaid,
      ordersFailed,
      ordersRefunded,
      subsStarted,
      subsCanceled,
      credits,
      tasksCreated,
      tasksFinished,
      tickets,
      productEvents,
      customRows,
    ] = await Promise.all([
      db()
        .select({
          id: user.id,
          createdAt: user.createdAt,
          utmSource: user.utmSource,
          referrer: user.referrer,
          country: user.country,
        })
        .from(user)
        .where(and(eq(user.id, userId), from(user.createdAt)))
        .limit(1),
      db()
        .select({
          id: order.id,
          orderNo: order.orderNo,
          at: order.createdAt,
          amount: order.amount,
          currency: order.currency,
          provider: order.paymentProvider,
          product: order.productName,
          plan: order.planName,
          paymentType: order.paymentType,
        })
        .from(order)
        .where(and(eq(order.userId, userId), from(order.createdAt)))
        .orderBy(by(order.createdAt))
        .limit(limit),
      db()
        .select({
          id: order.id,
          orderNo: order.orderNo,
          at: order.paidAt,
          createdAt: order.createdAt,
          amount: order.paymentAmount,
          orderAmount: order.amount,
          currency: order.paymentCurrency,
          orderCurrency: order.currency,
          provider: order.paymentProvider,
          product: order.productName,
        })
        .from(order)
        .where(
          and(
            eq(order.userId, userId),
            isNotNull(order.paidAt),
            from(order.paidAt)
          )
        )
        .orderBy(by(order.paidAt))
        .limit(limit),
      db()
        .select({
          id: order.id,
          orderNo: order.orderNo,
          at: order.updatedAt,
          product: order.productName,
        })
        .from(order)
        .where(
          and(
            eq(order.userId, userId),
            eq(order.status, 'failed'),
            from(order.updatedAt)
          )
        )
        .orderBy(by(order.updatedAt))
        .limit(limit),
      db()
        .select({
          id: order.id,
          orderNo: order.orderNo,
          at: order.refundedAt,
          createdAt: order.createdAt,
          amount: order.refundAmount,
          currency: order.currency,
        })
        .from(order)
        .where(
          and(
            eq(order.userId, userId),
            isNotNull(order.refundedAt),
            from(order.refundedAt)
          )
        )
        .orderBy(by(order.refundedAt))
        .limit(limit),
      db()
        .select({
          id: subscription.id,
          subscriptionNo: subscription.subscriptionNo,
          at: subscription.createdAt,
          plan: subscription.planName,
          product: subscription.productName,
          interval: subscription.interval,
          amount: subscription.amount,
          currency: subscription.currency,
        })
        .from(subscription)
        .where(
          and(eq(subscription.userId, userId), from(subscription.createdAt))
        )
        .orderBy(by(subscription.createdAt))
        .limit(limit),
      db()
        .select({
          id: subscription.id,
          subscriptionNo: subscription.subscriptionNo,
          at: subscription.canceledAt,
          plan: subscription.planName,
          reason: subscription.canceledReason,
        })
        .from(subscription)
        .where(
          and(
            eq(subscription.userId, userId),
            isNotNull(subscription.canceledAt),
            from(subscription.canceledAt)
          )
        )
        .orderBy(by(subscription.canceledAt))
        .limit(limit),
      db()
        .select({
          id: credit.id,
          transactionNo: credit.transactionNo,
          at: credit.createdAt,
          type: credit.transactionType,
          scene: credit.transactionScene,
          credits: credit.credits,
          description: credit.description,
          orderNo: credit.orderNo,
        })
        .from(credit)
        .where(
          and(
            eq(credit.userId, userId),
            ne(credit.status, 'deleted'),
            from(credit.createdAt)
          )
        )
        .orderBy(by(credit.createdAt))
        .limit(limit),
      db()
        .select({
          id: aiTask.id,
          at: aiTask.createdAt,
          mediaType: aiTask.mediaType,
          model: aiTask.model,
          cost: aiTask.costCredits,
        })
        .from(aiTask)
        .where(and(eq(aiTask.userId, userId), from(aiTask.createdAt)))
        .orderBy(by(aiTask.createdAt))
        .limit(limit),
      db()
        .select({
          id: aiTask.id,
          at: aiTask.updatedAt,
          status: aiTask.status,
          mediaType: aiTask.mediaType,
          model: aiTask.model,
        })
        .from(aiTask)
        .where(
          and(
            eq(aiTask.userId, userId),
            ne(aiTask.status, 'pending'),
            ne(aiTask.status, 'processing'),
            from(aiTask.updatedAt)
          )
        )
        .orderBy(by(aiTask.updatedAt))
        .limit(limit),
      db()
        .select({ id: ticket.id, at: ticket.createdAt, title: ticket.title })
        .from(ticket)
        .where(and(eq(ticket.userId, userId), from(ticket.createdAt)))
        .orderBy(by(ticket.createdAt))
        .limit(limit),
      db()
        .select({
          id: userEvent.id,
          at: userEvent.createdAt,
          kind: userEvent.kind,
          detail: userEvent.detail,
        })
        .from(userEvent)
        .where(and(eq(userEvent.userId, userId), from(userEvent.createdAt)))
        .orderBy(by(userEvent.createdAt))
        .limit(limit),
      Promise.all(
        customTimelineSources.map(async (source) => ({
          kind: source.kind,
          rows: await source.load({ userId, from, by, limit }),
        }))
      ),
    ]);

    const events: TimelineEvent[] = [];
    const push = (
      kind: string,
      id: string,
      at: unknown,
      detail: TimelineEvent['detail'],
      ref?: TimelineEvent['ref'],
      href?: string
    ) => {
      if (!at || Number.isNaN(toDate(at).getTime())) return;
      events.push({
        key: `${kind}:${id}`,
        at: toDate(at).toISOString(),
        kind,
        detail,
        ...(ref ? { ref } : {}),
        ...(href ? { href } : {}),
      });
    };

    if (profile)
      push('signup', profile.id, profile.createdAt, {
        source: profile.utmSource || null,
        referrer: profile.referrer || null,
        country: profile.country || null,
      });
    for (const o of ordersCreated)
      push(
        'order_created',
        o.id,
        o.at,
        {
          orderNo: o.orderNo,
          product: o.product || o.plan || null,
          amount: o.amount,
          currency: o.currency,
          provider: o.provider,
          paymentType: o.paymentType,
        },
        { type: 'order', id: o.orderNo }
      );
    for (const o of ordersPaid)
      push(
        'order_paid',
        o.id,
        notBefore(o.at, o.createdAt),
        {
          orderNo: o.orderNo,
          product: o.product || null,
          amount: o.amount ?? o.orderAmount,
          currency: o.currency || o.orderCurrency,
          provider: o.provider,
        },
        { type: 'order', id: o.orderNo }
      );
    for (const o of ordersFailed)
      push(
        'order_failed',
        o.id,
        o.at,
        { orderNo: o.orderNo, product: o.product || null },
        { type: 'order', id: o.orderNo }
      );
    for (const o of ordersRefunded)
      push(
        'order_refunded',
        o.id,
        notBefore(o.at, o.createdAt),
        { orderNo: o.orderNo, amount: o.amount, currency: o.currency },
        { type: 'order', id: o.orderNo }
      );
    for (const s of subsStarted)
      push(
        'subscription_started',
        s.id,
        s.at,
        {
          product: s.plan || s.product || null,
          interval: s.interval,
          amount: s.amount,
          currency: s.currency,
        },
        { type: 'subscription', id: s.subscriptionNo }
      );
    for (const s of subsCanceled)
      push(
        'subscription_canceled',
        s.id,
        s.at,
        { product: s.plan || null, reason: s.reason || null },
        { type: 'subscription', id: s.subscriptionNo }
      );
    for (const c of credits)
      push(
        c.type === 'consume' ? 'credits_consumed' : 'credits_granted',
        c.id,
        c.at,
        {
          credits: Math.abs(c.credits),
          scene: c.scene || null,
          description: c.description || null,
          orderNo: c.orderNo || null,
        },
        { type: 'credit', id: c.transactionNo }
      );
    for (const t of tasksCreated)
      push('task_created', t.id, t.at, {
        mediaType: t.mediaType,
        model: t.model,
        cost: t.cost,
      });
    for (const t of tasksFinished)
      push(
        t.status === 'success' ? 'task_succeeded' : 'task_failed',
        t.id,
        t.at,
        { mediaType: t.mediaType, model: t.model, status: t.status }
      );
    for (const t of tickets)
      push(
        'ticket_opened',
        t.id,
        t.at,
        { title: t.title },
        {
          type: 'ticket',
          id: t.id,
        }
      );

    for (const e of productEvents) {
      let detail: TimelineEvent['detail'] = {};
      try {
        if (e.detail) detail = JSON.parse(e.detail);
      } catch {
        // keep the event, drop an unreadable detail
      }
      push(e.kind, e.id, e.at, detail);
    }
    for (const source of customRows)
      for (const row of source.rows) {
        const href =
          typeof row.href === 'string' && /^\/(?![/\\])/.test(row.href)
            ? row.href
            : undefined;
        push(source.kind, row.id, row.at, row.detail ?? {}, undefined, href);
      }

    // Negative when `a` comes first in the requested order.
    const compare = (
      a: readonly [number, string],
      b: readonly [number, string]
    ) => {
      const c =
        a[0] - b[0] ||
        rankOf(a[1]) - rankOf(b[1]) ||
        (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      return ascending ? c : -c;
    };
    const sortKey = (e: { at: string; key: string }) =>
      [new Date(e.at).getTime(), e.key] as const;
    const page = events
      .filter(
        (e) =>
          !cursor || compare([cursor.at.getTime(), cursor.key], sortKey(e)) < 0
      )
      .sort((a, b) => compare(sortKey(a), sortKey(b)))
      .slice(0, limit);

    // Every source returned up to `limit` rows, so the merged page is exact.
    // A full page may have more behind it; a short one is the end.
    const last = page[page.length - 1];
    return respData({
      items: page,
      nextCursor:
        page.length === limit && last
          ? `${new Date(last.at).getTime()}~${last.key}`
          : null,
    });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
