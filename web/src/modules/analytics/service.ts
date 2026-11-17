import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import { order, subscription, ticket, user } from '@/config/db/schema';

/**
 * Signup → checkout → paid conversion, cohort-based: users who signed up in
 * the window, and how many of THOSE users ever started a checkout / paid.
 * Counts are distinct users; renewal orders are excluded so recurring billing
 * doesn't inflate conversion. Attribution is first-touch (stamped on the user
 * row at sign-up), so every number can be sliced by the same dimensions.
 */

export const FUNNEL_RANGES = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;
export type FunnelRange = keyof typeof FUNNEL_RANGES;

const DIMENSIONS = {
  utm_source: user.utmSource,
  utm_medium: user.utmMedium,
  utm_campaign: user.utmCampaign,
  utm_term: user.utmTerm,
  utm_content: user.utmContent,
  referrer: user.referrer,
  country: user.country,
} as const;
export type FunnelDimension = keyof typeof DIMENSIONS;
export const FUNNEL_DIMENSIONS = Object.keys(DIMENSIONS) as FunnelDimension[];

export interface FunnelCounts {
  signups: number;
  checkouts: number;
  paid: number;
}
export interface FunnelRow extends FunnelCounts {
  value: string;
}
export interface FunnelReport {
  range: FunnelRange;
  since: string;
  totals: FunnelCounts;
  groupBy: FunnelDimension;
  rows: FunnelRow[];
  /** Top values per dimension in the window, for building filter dropdowns. */
  options: Record<FunnelDimension, string[]>;
}

const MAX_ROWS = 100;
const MAX_OPTIONS = 50;

// Joined orders: any real checkout attempt (soft-deleted and renewals excluded).
const orderJoin = and(
  eq(order.userId, user.id),
  isNull(order.deletedAt),
  ne(order.status, 'deleted'),
  or(isNull(order.paymentType), ne(order.paymentType, 'renew'))
);

const counts = {
  signups: sql<number>`count(distinct ${user.id})`,
  checkouts: sql<number>`count(distinct case when ${order.id} is not null then ${user.id} end)`,
  // A later refund moves the order to refunding/refunded; the payment still
  // happened, so it stays a conversion.
  paid: sql<number>`count(distinct case when ${order.status} in ('paid', 'refunding', 'refunded') then ${user.id} end)`,
};

function toCounts(
  row: { signups: unknown; checkouts: unknown; paid: unknown } | undefined
): FunnelCounts {
  return {
    signups: Number(row?.signups ?? 0),
    checkouts: Number(row?.checkouts ?? 0),
    paid: Number(row?.paid ?? 0),
  };
}

export async function getFunnelReport({
  range,
  groupBy,
  filters,
}: {
  range: FunnelRange;
  groupBy: FunnelDimension;
  filters: Partial<Record<FunnelDimension, string>>;
}): Promise<FunnelReport> {
  const since = new Date(Date.now() - FUNNEL_RANGES[range]);
  // Agent service accounts (type 'api') are not sign-ups.
  const inWindow = and(gte(user.createdAt, since), eq(user.type, 'user'))!;

  const conditions: SQL[] = [inWindow];
  for (const dim of FUNNEL_DIMENSIONS) {
    const value = filters[dim];
    // '' is a real value (direct / untagged), so only undefined means "any".
    if (value !== undefined) conditions.push(eq(DIMENSIONS[dim], value));
  }
  const where = and(...conditions);
  const groupCol = DIMENSIONS[groupBy];

  const [totalsRows, rows, optionLists] = await Promise.all([
    db().select(counts).from(user).leftJoin(order, orderJoin).where(where),
    db()
      .select({ value: groupCol, ...counts })
      .from(user)
      .leftJoin(order, orderJoin)
      .where(where)
      .groupBy(groupCol)
      .orderBy(desc(counts.signups))
      .limit(MAX_ROWS),
    // Options ignore the active filters so a selected value never hides its
    // siblings, but stay scoped to the window.
    Promise.all(
      FUNNEL_DIMENSIONS.map((dim) =>
        db()
          .select({ value: DIMENSIONS[dim] })
          .from(user)
          .where(inWindow)
          .groupBy(DIMENSIONS[dim])
          .orderBy(desc(sql`count(*)`))
          .limit(MAX_OPTIONS)
      )
    ),
  ]);

  const options = Object.fromEntries(
    FUNNEL_DIMENSIONS.map((dim, i) => [
      dim,
      optionLists[i].map((r: { value: string }) => r.value),
    ])
  ) as Record<FunnelDimension, string[]>;

  return {
    range,
    since: since.toISOString(),
    totals: toCounts(totalsRows[0]),
    groupBy,
    rows: rows.map((r: { value: string } & FunnelCounts) => ({
      value: r.value,
      ...toCounts(r),
    })),
    options,
  };
}

// ─── Overview KPIs ───────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
// Statuses of an order whose money actually arrived (a refund comes later).
const PAID_STATUSES = ['paid', 'refunding', 'refunded'];
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'pending_cancel'];

export interface OverviewStats {
  users: { total: number; new24h: number };
  /** Last 30 days by paidAt, renewals included, refunds subtracted. Minor units. */
  revenue30d: { currency: string; amount: number; orders: number }[];
  subscriptions: { active: number; trialing: number };
  openTickets: number;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const now = Date.now();
  const currency = sql<string>`lower(coalesce(${order.paymentCurrency}, ${order.currency}))`;

  const [users, newUsers, revenue, subs, tickets] = await Promise.all([
    db().select({ n: count() }).from(user).where(eq(user.type, 'user')),
    db()
      .select({ n: count() })
      .from(user)
      .where(
        and(eq(user.type, 'user'), gte(user.createdAt, new Date(now - DAY_MS)))
      ),
    db()
      .select({
        currency,
        amount: sql<number>`sum(coalesce(${order.paymentAmount}, ${order.amount}) - coalesce(${order.refundAmount}, 0))`,
        orders: count(),
      })
      .from(order)
      .where(
        and(
          inArray(order.status, PAID_STATUSES),
          isNull(order.deletedAt),
          gte(order.paidAt, new Date(now - 30 * DAY_MS))
        )
      )
      .groupBy(currency),
    db()
      .select({ status: subscription.status, n: count() })
      .from(subscription)
      .where(inArray(subscription.status, LIVE_SUBSCRIPTION_STATUSES))
      .groupBy(subscription.status),
    db().select({ n: count() }).from(ticket).where(eq(ticket.status, 'open')),
  ]);

  const subCount = (status?: string) =>
    subs
      .filter((r: { status: string }) => !status || r.status === status)
      .reduce((sum: number, r: { n: unknown }) => sum + Number(r.n), 0);

  return {
    users: {
      total: Number(users[0]?.n ?? 0),
      new24h: Number(newUsers[0]?.n ?? 0),
    },
    revenue30d: revenue
      .map((r: { currency: string; amount: unknown; orders: unknown }) => ({
        currency: r.currency || 'usd',
        amount: Number(r.amount ?? 0),
        orders: Number(r.orders ?? 0),
      }))
      .sort(
        (a: { amount: number }, b: { amount: number }) => b.amount - a.amount
      ),
    subscriptions: { active: subCount(), trialing: subCount('trialing') },
    openTickets: Number(tickets[0]?.n ?? 0),
  };
}

// ─── Period report (for agents pulling scheduled reports) ────────────────────

export const REPORT_MAX_DAYS = 92;

export interface ReportPeriod {
  from: string;
  to: string;
  users: { new: number };
  checkout: { users: number; orders: number };
  payments: {
    /** All orders paid in the window by paidAt, renewals included. */
    orders: number;
    newPurchases: number;
    renewals: number;
    payingUsers: number;
    /** Users whose first-ever payment falls in the window. */
    firstTimePayers: number;
    /** Minor units per currency; refunds counted by refundedAt. */
    revenue: {
      currency: string;
      gross: number;
      refunded: number;
      net: number;
    }[];
  };
  rates: {
    /** Of non-renewal orders created in the window, the share already paid. */
    checkoutToPaid: number | null;
    /** Of users who signed up in the window, the share who paid before `to`. */
    signupToPaid: number | null;
  };
  subscriptions: { new: number; canceled: number };
}

export interface Report {
  generatedAt: string;
  current: ReportPeriod;
  /** Same metrics for the preceding period of equal length, for deltas. */
  previous: ReportPeriod | null;
  /** Live subscriptions right now (not period-bound). */
  subscriptionsActiveNow: number;
}

const ratio = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 10000) / 10000 : null;

async function reportPeriod(from: Date, to: Date): Promise<ReportPeriod> {
  const notRenewal = or(
    isNull(order.paymentType),
    ne(order.paymentType, 'renew')
  )!;
  const live = isNull(order.deletedAt);
  const paidStatus = inArray(order.status, PAID_STATUSES);
  const paidInWindow = and(
    live,
    paidStatus,
    gte(order.paidAt, from),
    lt(order.paidAt, to)
  );
  const createdInWindow = and(
    live,
    ne(order.status, 'deleted'),
    notRenewal,
    gte(order.createdAt, from),
    lt(order.createdAt, to)
  );
  const currency = sql<string>`lower(coalesce(${order.paymentCurrency}, ${order.currency}))`;
  const n = (rows: { n: unknown }[]) => Number(rows[0]?.n ?? 0);

  const [
    newUsers,
    checkout,
    paid,
    earlierPayers,
    gross,
    refunds,
    cohort,
    subsNew,
    subsCanceled,
  ] = await Promise.all([
    db()
      .select({ n: count() })
      .from(user)
      .where(
        and(
          eq(user.type, 'user'),
          gte(user.createdAt, from),
          lt(user.createdAt, to)
        )
      ),
    db()
      .select({
        users: sql<number>`count(distinct ${order.userId})`,
        orders: count(),
        paid: sql<number>`sum(case when ${order.status} in ('paid', 'refunding', 'refunded') then 1 else 0 end)`,
      })
      .from(order)
      .where(createdInWindow),
    db()
      .select({
        orders: count(),
        renewals: sql<number>`sum(case when ${order.paymentType} = 'renew' then 1 else 0 end)`,
        users: sql<number>`count(distinct ${order.userId})`,
      })
      .from(order)
      .where(paidInWindow),
    // Window payers who had already paid before the window.
    db()
      .select({ n: sql<number>`count(distinct ${order.userId})` })
      .from(order)
      .where(
        and(
          live,
          paidStatus,
          lt(order.paidAt, from),
          inArray(
            order.userId,
            db().select({ id: order.userId }).from(order).where(paidInWindow)
          )
        )
      ),
    db()
      .select({
        currency,
        amount: sql<number>`sum(coalesce(${order.paymentAmount}, ${order.amount}))`,
      })
      .from(order)
      .where(paidInWindow)
      .groupBy(currency),
    db()
      .select({
        currency,
        amount: sql<number>`sum(coalesce(${order.refundAmount}, 0))`,
      })
      .from(order)
      .where(and(live, gte(order.refundedAt, from), lt(order.refundedAt, to)))
      .groupBy(currency),
    // Sign-ups in the window, and how many of them paid before `to`.
    db()
      .select({
        paid: sql<number>`count(distinct case when ${order.id} is not null then ${user.id} end)`,
      })
      .from(user)
      .leftJoin(
        order,
        and(
          eq(order.userId, user.id),
          live,
          paidStatus,
          notRenewal,
          lt(order.paidAt, to)
        )
      )
      .where(
        and(
          eq(user.type, 'user'),
          gte(user.createdAt, from),
          lt(user.createdAt, to)
        )
      ),
    db()
      .select({ n: count() })
      .from(subscription)
      .where(
        and(gte(subscription.createdAt, from), lt(subscription.createdAt, to))
      ),
    db()
      .select({ n: count() })
      .from(subscription)
      .where(
        and(gte(subscription.canceledAt, from), lt(subscription.canceledAt, to))
      ),
  ]);

  const revenue = new Map<string, { gross: number; refunded: number }>();
  for (const r of gross as { currency: string; amount: unknown }[]) {
    const c = r.currency || 'usd';
    revenue.set(c, {
      gross: Number(r.amount ?? 0),
      refunded: revenue.get(c)?.refunded ?? 0,
    });
  }
  for (const r of refunds as { currency: string; amount: unknown }[]) {
    const c = r.currency || 'usd';
    revenue.set(c, {
      gross: revenue.get(c)?.gross ?? 0,
      refunded: Number(r.amount ?? 0),
    });
  }

  const signups = n(newUsers);
  const created = Number(checkout[0]?.orders ?? 0);
  const paidOrders = Number(paid[0]?.orders ?? 0);
  const renewals = Number(paid[0]?.renewals ?? 0);
  const payingUsers = Number(paid[0]?.users ?? 0);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    users: { new: signups },
    checkout: { users: Number(checkout[0]?.users ?? 0), orders: created },
    payments: {
      orders: paidOrders,
      newPurchases: paidOrders - renewals,
      renewals,
      payingUsers,
      firstTimePayers: payingUsers - n(earlierPayers),
      revenue: [...revenue.entries()]
        .map(([currency, v]) => ({ currency, ...v, net: v.gross - v.refunded }))
        .sort((a, b) => b.gross - a.gross),
    },
    rates: {
      checkoutToPaid: ratio(Number(checkout[0]?.paid ?? 0), created),
      signupToPaid: ratio(Number(cohort[0]?.paid ?? 0), signups),
    },
    subscriptions: { new: n(subsNew), canceled: n(subsCanceled) },
  };
}

export async function getReport({
  from,
  to,
  compare = true,
}: {
  from: Date;
  to: Date;
  compare?: boolean;
}): Promise<Report> {
  const span = to.getTime() - from.getTime();
  const [current, previous, active] = await Promise.all([
    reportPeriod(from, to),
    compare ? reportPeriod(new Date(from.getTime() - span), from) : null,
    db()
      .select({ n: count() })
      .from(subscription)
      .where(inArray(subscription.status, LIVE_SUBSCRIPTION_STATUSES)),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    current,
    previous,
    subscriptionsActiveNow: Number(active[0]?.n ?? 0),
  };
}
