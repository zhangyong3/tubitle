/**
 * Bot notifications for business events: paid orders and new tickets.
 *
 * Channel delivery lives in @/core/notify; this module decides *when* to
 * notify and assembles the message from the order + the paying user's
 * attribution data (UTM, country, sign-up time).
 */

import { and, count, eq, lte } from 'drizzle-orm';

import { db } from '@/core/db';
import {
  sendToChannels,
  type NotifyChannel,
  type NotifyChannelConfig,
  type NotifyResult,
} from '@/core/notify';
import { envConfigs } from '@/config';
import {
  guestPost,
  order,
  post,
  subscription,
  user,
  type Order,
  type User,
} from '@/config/db/schema';
import { getPricingProduct } from '@/config/pricing';
import { getAllConfigs } from '@/modules/config/service';

import {
  GUEST_POST_EVENT_LABELS,
  GUEST_POST_TEMPLATES,
  normalizeNotifyLanguage,
  PAYMENT_TEMPLATES,
  renderTemplate,
  TICKET_TEMPLATES,
  type NotifyLanguage,
  type PaymentTemplateVars,
  type TicketTemplateVars,
} from './templates';

const PROVIDER_NAMES: Record<string, string> = {
  stripe: 'Stripe',
  creem: 'Creem',
  paypal: 'PayPal',
  alipay: 'Alipay',
  wechat: 'WeChat Pay',
};

type IntervalUnit = 'day' | 'week' | 'month' | 'year';

const INTERVAL_LABELS: Record<
  NotifyLanguage,
  Record<IntervalUnit, { single: string; unit: string }>
> = {
  zh: {
    day: { single: '日付', unit: '天' },
    week: { single: '周付', unit: '周' },
    month: { single: '月付', unit: '个月' },
    year: { single: '年付', unit: '年' },
  },
  en: {
    day: { single: 'Daily', unit: 'days' },
    week: { single: 'Weekly', unit: 'weeks' },
    month: { single: 'Monthly', unit: 'months' },
    year: { single: 'Yearly', unit: 'years' },
  },
};

function formatChargeType(
  kind: 'first' | 'renew' | 'one-time',
  chargeIndex: number | undefined,
  language: NotifyLanguage
) {
  if (language === 'zh') {
    if (kind === 'first') return '订阅首次扣费';
    if (kind === 'renew')
      return chargeIndex ? `订阅续费（第 ${chargeIndex} 次扣费）` : '订阅续费';
    return '一次性付费';
  }
  if (kind === 'first') return 'First subscription charge';
  if (kind === 'renew')
    return chargeIndex
      ? `Subscription renewal (charge #${chargeIndex})`
      : 'Subscription renewal';
  return 'One-time payment';
}

function formatBillingCycle(
  interval: string | null | undefined,
  intervalCount: number | null | undefined,
  language: NotifyLanguage
) {
  const labels = INTERVAL_LABELS[language][interval as IntervalUnit];
  if (!labels) return '';
  const count = intervalCount && intervalCount > 1 ? intervalCount : 1;
  if (count === 1) return labels.single;
  return language === 'zh'
    ? `每 ${count} ${labels.unit}`
    : `Every ${count} ${labels.unit}`;
}

// Currencies whose smallest unit is the whole unit (amounts aren't in cents).
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
  'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]); // prettier-ignore

// --- Config ---

export function getNotifyChannelConfig(
  configs: Record<string, string>,
  only?: NotifyChannel
): NotifyChannelConfig {
  const c = (key: string) => (configs[key] || '').trim();
  const result: NotifyChannelConfig = {};

  if ((!only || only === 'telegram') && c('telegram_bot_token')) {
    if (c('telegram_chat_id')) {
      result.telegram = {
        botToken: c('telegram_bot_token'),
        chatId: c('telegram_chat_id'),
        apiBase: c('telegram_api_base') || undefined,
      };
    }
  }
  if ((!only || only === 'feishu') && c('feishu_webhook_url')) {
    result.feishu = {
      webhookUrl: c('feishu_webhook_url'),
      secret: c('feishu_secret') || undefined,
    };
  }
  if ((!only || only === 'wecom') && c('wecom_webhook_url')) {
    result.wecom = { webhookUrl: c('wecom_webhook_url') };
  }
  if ((!only || only === 'webhook') && c('notify_webhook_url')) {
    result.webhook = {
      url: c('notify_webhook_url'),
      token: c('notify_webhook_token') || undefined,
    };
  }
  return result;
}

// A channel is only used when all of these are set (see above).
const CHANNEL_REQUIRED_FIELDS: Record<NotifyChannel, [string, string][]> = {
  telegram: [
    ['telegram_bot_token', 'Bot Token'],
    ['telegram_chat_id', 'Chat ID'],
  ],
  feishu: [['feishu_webhook_url', 'Webhook URL']],
  wecom: [['wecom_webhook_url', 'Webhook URL']],
  webhook: [['notify_webhook_url', 'Webhook URL']],
};

// --- Formatting ---

function adminBase(configs: Record<string, string>) {
  return (configs.app_url || envConfigs.app_url).replace(/\/+$/, '');
}

/** "nickname <email>", or whichever part exists. */
function formatUser(name: string | null | undefined, email: string) {
  const n = (name || '').trim();
  if (n && email) return `${n} <${email}>`;
  return n || email;
}

// Keep long ticket bodies from flooding the chat.
const TICKET_CONTENT_MAX = 500;

function formatMoney(amountMinor: number | null | undefined, currency: string) {
  if (amountMinor === null || amountMinor === undefined) return '';
  const code = (currency || 'usd').toLowerCase();
  const value = ZERO_DECIMAL_CURRENCIES.has(code)
    ? amountMinor
    : amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code.toUpperCase(),
    }).format(value);
  } catch {
    return `${value} ${code.toUpperCase()}`;
  }
}

function formatTime(date: Date | null | undefined, timeZone: string) {
  if (!date) return '';
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  try {
    // sv-SE renders as "YYYY-MM-DD HH:mm:ss".
    return new Intl.DateTimeFormat('sv-SE', { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('sv-SE', {
      ...opts,
      timeZone: 'UTC',
    }).format(date);
  }
}

function formatCountry(code: string, language: NotifyLanguage) {
  if (!code) return '';
  try {
    const name = new Intl.DisplayNames([language === 'zh' ? 'zh-CN' : 'en'], {
      type: 'region',
    }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

export function buildPaymentVars(params: {
  order: Pick<
    Order,
    | 'orderNo'
    | 'amount'
    | 'currency'
    | 'paymentAmount'
    | 'paymentCurrency'
    | 'paymentType'
    | 'paymentProvider'
    | 'productName'
    | 'planName'
    | 'creditsAmount'
    | 'discountCode'
    | 'discountAmount'
    | 'discountCurrency'
    | 'userEmail'
    | 'paymentEmail'
    | 'paidAt'
    | 'paymentInterval'
  >;
  /** Subscription billing period (falls back to order.paymentInterval). */
  subscription?: {
    interval: string | null;
    intervalCount: number | null;
  } | null;
  /** 1-based position of this charge within its subscription. */
  chargeIndex?: number;
  user?: Pick<
    User,
    | 'name'
    | 'email'
    | 'createdAt'
    | 'utmSource'
    | 'utmCampaign'
    | 'utmTerm'
    | 'country'
    | 'ip'
    | 'locale'
  > | null;
  configs: Record<string, string>;
}): PaymentTemplateVars {
  const { order: o, user: u, subscription: sub, chargeIndex, configs } = params;
  const language = normalizeNotifyLanguage(configs.notify_language);
  const timeZone = configs.notify_timezone?.trim() || 'Asia/Shanghai';

  const chargeKind =
    o.paymentType === 'renew'
      ? 'renew'
      : o.paymentType === 'subscription'
        ? 'first'
        : 'one-time';
  const billingCycle =
    chargeKind === 'one-time'
      ? ''
      : formatBillingCycle(
          sub?.interval || o.paymentInterval,
          sub?.intervalCount,
          language
        );

  const currency = o.paymentCurrency || o.currency;
  const country = (u?.country || '').toUpperCase();

  return {
    app_name: configs.app_name || envConfigs.app_name,
    provider: PROVIDER_NAMES[o.paymentProvider] || o.paymentProvider,
    charge_type: formatChargeType(chargeKind, chargeIndex, language),
    charge_index: chargeIndex ? String(chargeIndex) : '',
    billing_cycle: billingCycle,
    payment_type: o.paymentType || '',
    order_no: o.orderNo,
    amount: formatMoney(o.paymentAmount ?? o.amount, currency),
    list_amount: listAmount(o),
    product_name: o.productName || '',
    plan_name: o.planName || o.productName || '',
    credits: o.creditsAmount ? String(o.creditsAmount) : '',
    discount_code: o.discountCode || '',
    email: u?.email || o.userEmail || o.paymentEmail || '',
    user: formatUser(u?.name, u?.email || o.userEmail || o.paymentEmail || ''),
    user_name: u?.name || '',
    registered_at: formatTime(u?.createdAt, timeZone),
    paid_at: formatTime(o.paidAt || new Date(), timeZone),
    country: formatCountry(country, language),
    country_code: country,
    utm_source: u?.utmSource || '',
    utm_campaign: u?.utmCampaign || '',
    utm_term: u?.utmTerm || '',
    ip: u?.ip || '',
    locale: u?.locale || '',
    admin_url: `${adminBase(configs)}/admin/payments?search=${encodeURIComponent(o.orderNo)}`,
  };
}

// Price before the coupon. `order.amount` can't be used as is: an in-house
// coupon is subtracted from it at checkout, while a provider coupon (Stripe
// promotion code) leaves it at the catalog price. Paid + discount is right
// for both whenever the discount is in the currency that was charged.
function listAmount(
  o: Pick<
    Order,
    | 'amount'
    | 'currency'
    | 'paymentAmount'
    | 'paymentCurrency'
    | 'discountAmount'
    | 'discountCurrency'
  >
) {
  const currency = o.paymentCurrency || o.currency;
  const discount = o.discountAmount || 0;
  const sameCurrency =
    !o.discountCurrency ||
    o.discountCurrency.toLowerCase() === (currency || '').toLowerCase();
  if (discount > 0 && sameCurrency)
    return formatMoney((o.paymentAmount ?? o.amount) + discount, currency);
  return formatMoney(o.amount, o.currency);
}

export function renderPaymentMessage(
  vars: PaymentTemplateVars,
  configs: Record<string, string>
): string {
  const language = normalizeNotifyLanguage(configs.notify_language);
  return renderTemplate(PAYMENT_TEMPLATES[language], vars);
}

// --- Events ---

/**
 * Push a "payment succeeded" message for a paid order to every configured
 * bot. Never throws — a notification failure must not fail the webhook.
 */
export async function notifyPaymentSuccess(orderNo: string): Promise<void> {
  try {
    const configs = await getAllConfigs();
    if (configs.notify_payment_enabled !== 'true') return;

    const channels = getNotifyChannelConfig(configs);
    if (Object.keys(channels).length === 0) return;

    const [row] = await db()
      .select()
      .from(order)
      .where(eq(order.orderNo, orderNo))
      .limit(1);
    if (!row) return;

    const [payer] = row.userId
      ? await db().select().from(user).where(eq(user.id, row.userId)).limit(1)
      : [];

    let sub: { interval: string | null; intervalCount: number | null } | null =
      null;
    let chargeIndex: number | undefined;
    if (row.subscriptionNo) {
      [sub] = await db()
        .select({
          interval: subscription.interval,
          intervalCount: subscription.intervalCount,
        })
        .from(subscription)
        .where(eq(subscription.subscriptionNo, row.subscriptionNo))
        .limit(1);
      // Paid orders of this subscription up to and including this one.
      const [{ value }] = await db()
        .select({ value: count() })
        .from(order)
        .where(
          and(
            eq(order.subscriptionNo, row.subscriptionNo),
            eq(order.status, 'paid'),
            lte(order.createdAt, row.createdAt)
          )
        );
      chargeIndex = Number(value) || undefined;
    }

    const vars = buildPaymentVars({
      order: row,
      user: payer,
      subscription: sub,
      chargeIndex,
      configs,
    });
    const text = renderPaymentMessage(vars, configs);
    const results = await sendToChannels(channels, text, {
      event: 'payment.succeeded',
      data: { order_no: row.orderNo, ...vars },
    });
    for (const r of results) {
      if (!r.success) {
        console.error(`[notify] ${r.channel} failed for ${orderNo}:`, r.error);
      }
    }
  } catch (error) {
    console.error('[notify] payment notification failed', error);
  }
}

/** Admin "Test" button: render a sample order and send it. */
export async function sendTestPaymentNotification(
  configs: Record<string, string>,
  only?: NotifyChannel
): Promise<NotifyResult[]> {
  const channels = getNotifyChannelConfig(configs, only);
  if (Object.keys(channels).length === 0) {
    if (!only) throw new Error('No notification channel is configured');
    const missing = CHANNEL_REQUIRED_FIELDS[only]
      .filter(([key]) => !(configs[key] || '').trim())
      .map(([, label]) => label);
    throw new Error(`Please fill in: ${missing.join(', ')}`);
  }

  const now = new Date();
  const vars = buildPaymentVars({
    order: {
      orderNo: 'TEST-ORDER',
      amount: 2900,
      currency: 'usd',
      paymentAmount: 2900,
      paymentCurrency: 'usd',
      paymentType: 'renew',
      paymentInterval: 'month',
      paymentProvider: 'stripe',
      productName: 'Pro',
      planName: 'Pro',
      creditsAmount: 50000,
      discountCode: null,
      discountAmount: null,
      discountCurrency: null,
      userEmail: 'buyer@example.com',
      paymentEmail: null,
      paidAt: now,
    },
    chargeIndex: 3,
    user: {
      name: 'Test Buyer',
      email: 'buyer@example.com',
      createdAt: new Date(now.getTime() - 21_000),
      utmSource: 'google',
      utmCampaign: 'spring_sale',
      utmTerm: 'ai tool',
      country: 'US',
      ip: '203.0.113.7',
      locale: 'en',
    },
    configs,
  });
  const language = normalizeNotifyLanguage(configs.notify_language);
  const prefix = language === 'zh' ? '[测试] ' : '[Test] ';
  return sendToChannels(
    channels,
    prefix + renderPaymentMessage(vars, configs),
    {
      event: 'payment.succeeded',
      data: { order_no: 'TEST-ORDER', ...vars },
      test: true,
    }
  );
}

// --- Tickets ---

type TicketAuthor = Pick<User, 'name' | 'email' | 'createdAt' | 'country'>;

export type TicketEvent = 'created' | 'replied';

const TICKET_EVENT_LABELS: Record<
  NotifyLanguage,
  Record<TicketEvent, string>
> = {
  zh: { created: '新工单', replied: '工单新回复' },
  en: { created: 'New ticket', replied: 'New ticket reply' },
};

export function buildTicketVars(params: {
  event?: TicketEvent;
  ticket: { id: string; title: string; createdAt: Date | null };
  /** When the message was sent; defaults to the ticket's creation time. */
  sentAt?: Date;
  content: string;
  attachments?: number;
  user?: TicketAuthor | null;
  configs: Record<string, string>;
}): TicketTemplateVars {
  const { ticket: t, user: u, configs } = params;
  const language = normalizeNotifyLanguage(configs.notify_language);
  const timeZone = configs.notify_timezone?.trim() || 'Asia/Shanghai';
  const content = params.content.trim();

  return {
    event: TICKET_EVENT_LABELS[language][params.event ?? 'created'],
    app_name: configs.app_name || envConfigs.app_name,
    title: t.title,
    content:
      content.length > TICKET_CONTENT_MAX
        ? `${content.slice(0, TICKET_CONTENT_MAX)}…`
        : content,
    attachments: params.attachments ? String(params.attachments) : '',
    email: u?.email || '',
    user: formatUser(u?.name, u?.email || ''),
    user_name: u?.name || '',
    registered_at: formatTime(u?.createdAt, timeZone),
    created_at: formatTime(
      params.sentAt || t.createdAt || new Date(),
      timeZone
    ),
    country: formatCountry((u?.country || '').toUpperCase(), language),
    admin_url: `${adminBase(configs)}/admin/tickets?id=${encodeURIComponent(t.id)}`,
  };
}

function renderTicketMessage(
  vars: TicketTemplateVars,
  configs: Record<string, string>
) {
  const language = normalizeNotifyLanguage(configs.notify_language);
  return renderTemplate(TICKET_TEMPLATES[language], vars);
}

/**
 * Push a ticket message (new ticket, or a user's reply) to every configured
 * bot. Never throws — a notification failure must not fail the request.
 */
export async function notifyTicketEvent(params: {
  event: TicketEvent;
  ticket: { id: string; userId: string; title: string; createdAt: Date | null };
  content: string;
  attachments?: number;
  sentAt?: Date;
}): Promise<void> {
  try {
    const configs = await getAllConfigs();
    // One switch covers both new tickets and user replies.
    if (configs.notify_ticket_enabled !== 'true') return;

    const channels = getNotifyChannelConfig(configs);
    if (Object.keys(channels).length === 0) return;

    const [author] = await db()
      .select()
      .from(user)
      .where(eq(user.id, params.ticket.userId))
      .limit(1);

    const vars = buildTicketVars({ ...params, user: author, configs });
    const text = renderTicketMessage(vars, configs);
    const results = await sendToChannels(channels, text, {
      event: `ticket.${params.event}`,
      data: { ticket_id: params.ticket.id, ...vars },
    });
    for (const r of results) {
      if (!r.success) {
        console.error(
          `[notify] ${r.channel} failed for ticket ${params.ticket.id}:`,
          r.error
        );
      }
    }
  } catch (error) {
    console.error('[notify] ticket notification failed', error);
  }
}

type GuestPostEvent = 'submitted' | 'resubmitted';

function buildGuestPostVars(params: {
  event: GuestPostEvent;
  guestPost: {
    id: string;
    title: string;
    slug: string;
    packageName: string;
    submittedAt: Date | null;
  };
  /** What the author paid (the order), if known. */
  paid?: { amount: number; currency: string } | null;
  user?: TicketAuthor | null;
  configs: Record<string, string>;
}) {
  const { guestPost: g, user: u, configs } = params;
  const language = normalizeNotifyLanguage(configs.notify_language);
  const timeZone = configs.notify_timezone?.trim() || 'Asia/Shanghai';
  const base = adminBase(configs);
  return {
    event: GUEST_POST_EVENT_LABELS[language][params.event],
    app_name: configs.app_name || envConfigs.app_name,
    title: g.title,
    package: g.packageName,
    amount: params.paid
      ? formatMoney(params.paid.amount, params.paid.currency)
      : '',
    user: formatUser(u?.name, u?.email || ''),
    registered_at: formatTime(u?.createdAt, timeZone),
    submitted_at: formatTime(g.submittedAt || new Date(), timeZone),
    country: formatCountry((u?.country || '').toUpperCase(), language),
    preview_url: g.slug
      ? `${base}/blog/${encodeURIComponent(g.slug)}?preview=1`
      : '',
    admin_url: `${base}/admin/guest-posts?id=${encodeURIComponent(g.id)}`,
  };
}

/**
 * A guest post entered the review queue: paid (`submitted`) or edited after
 * a change request (`resubmitted`). On unless the admin turned it off.
 * Never throws.
 */
export async function notifyGuestPostSubmitted(
  guestPostId: string,
  event: GuestPostEvent = 'submitted'
): Promise<void> {
  try {
    const configs = await getAllConfigs();
    if (configs.notify_guest_post_enabled === 'false') return;
    const channels = getNotifyChannelConfig(configs);
    if (Object.keys(channels).length === 0) return;

    const [row] = await db()
      .select({
        title: post.title,
        slug: post.slug,
        productId: guestPost.productId,
        submittedAt: guestPost.submittedAt,
        orderNo: guestPost.orderNo,
        userName: user.name,
        userEmail: user.email,
        userCreatedAt: user.createdAt,
        userCountry: user.country,
      })
      .from(guestPost)
      .innerJoin(post, eq(post.id, guestPost.postId))
      .leftJoin(user, eq(user.id, guestPost.userId))
      .where(eq(guestPost.id, guestPostId))
      .limit(1);
    if (!row) return;

    const [paidOrder] = row.orderNo
      ? await db()
          .select({
            amount: order.amount,
            paymentAmount: order.paymentAmount,
            currency: order.currency,
          })
          .from(order)
          .where(eq(order.orderNo, row.orderNo))
          .limit(1)
      : [];

    const vars = buildGuestPostVars({
      event,
      guestPost: {
        id: guestPostId,
        title: row.title || '',
        slug: row.slug,
        packageName:
          getPricingProduct(row.productId)?.planName || row.productId,
        submittedAt: row.submittedAt,
      },
      paid: paidOrder
        ? {
            amount: paidOrder.paymentAmount ?? paidOrder.amount,
            currency: paidOrder.currency,
          }
        : null,
      user: row.userEmail
        ? {
            name: row.userName,
            email: row.userEmail,
            createdAt: row.userCreatedAt,
            country: row.userCountry,
          }
        : null,
      configs,
    });
    const language = normalizeNotifyLanguage(configs.notify_language);
    const results = await sendToChannels(
      channels,
      renderTemplate(GUEST_POST_TEMPLATES[language], vars),
      {
        event: `guest_post.${event}`,
        data: { guest_post_id: guestPostId, ...vars },
      }
    );
    for (const r of results) {
      if (!r.success) {
        console.error(
          `[notify] ${r.channel} failed for guest post ${guestPostId}:`,
          r.error
        );
      }
    }
  } catch (error) {
    console.error('[notify] guest post notification failed', error);
  }
}

/** Admin "Test" button: a sample guest post submission. */
export async function sendTestGuestPostNotification(
  configs: Record<string, string>
): Promise<NotifyResult[]> {
  const channels = getNotifyChannelConfig(configs);
  if (Object.keys(channels).length === 0) {
    throw new Error('No notification channel is configured');
  }
  const now = new Date();
  const zh = normalizeNotifyLanguage(configs.notify_language) === 'zh';
  const vars = buildGuestPostVars({
    event: 'submitted',
    guestPost: {
      id: 'TEST-GUEST-POST',
      title: zh
        ? '10 个提升 SaaS 转化率的方法'
        : '10 ways to lift SaaS conversion',
      slug: 'test-guest-post',
      packageName: 'Premium',
      submittedAt: now,
    },
    paid: { amount: 19900, currency: 'usd' },
    user: {
      name: 'Test Author',
      email: 'author@example.com',
      createdAt: new Date(now.getTime() - 3 * 86_400_000),
      country: 'US',
    },
    configs,
  });
  const language = normalizeNotifyLanguage(configs.notify_language);
  return sendToChannels(
    channels,
    (zh ? '[测试] ' : '[Test] ') +
      renderTemplate(GUEST_POST_TEMPLATES[language], vars),
    {
      event: 'guest_post.submitted',
      data: { guest_post_id: 'TEST-GUEST-POST', ...vars },
      test: true,
    }
  );
}

/** Admin "Test" button for the ticket group: send a sample ticket. */
export async function sendTestTicketNotification(
  configs: Record<string, string>
): Promise<NotifyResult[]> {
  const channels = getNotifyChannelConfig(configs);
  if (Object.keys(channels).length === 0) {
    throw new Error('No notification channel is configured');
  }

  const now = new Date();
  const zh = normalizeNotifyLanguage(configs.notify_language) === 'zh';
  const vars = buildTicketVars({
    ticket: {
      id: 'TEST-TICKET',
      title: zh ? '积分没有到账' : 'Credits not added after payment',
      createdAt: now,
    },
    content: zh
      ? '我刚刚购买了 Pro 套餐，但是积分一直没有到账，请帮忙看一下。'
      : 'I just bought the Pro plan but my credits never showed up. Could you take a look?',
    attachments: 1,
    user: {
      name: 'Test User',
      email: 'buyer@example.com',
      createdAt: new Date(now.getTime() - 3 * 86_400_000),
      country: 'US',
    },
    configs,
  });
  return sendToChannels(
    channels,
    (zh ? '[测试] ' : '[Test] ') + renderTicketMessage(vars, configs),
    {
      event: 'ticket.created',
      data: { ticket_id: 'TEST-TICKET', ...vars },
      test: true,
    }
  );
}
