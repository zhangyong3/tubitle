/**
 * Built-in payment notification templates (not admin-editable).
 *
 * Syntax:
 *   {{var}}              value, or "-" when empty
 *   {{#var}}...{{/var}}  section rendered only when var is non-empty
 */

export type NotifyLanguage = 'zh' | 'en';

export const PAYMENT_TEMPLATE_VARS = [
  'app_name',
  'provider',
  'charge_type',
  'charge_index',
  'billing_cycle',
  'payment_type',
  'order_no',
  'amount',
  'list_amount',
  'product_name',
  'plan_name',
  'credits',
  'discount_code',
  'user',
  'email',
  'user_name',
  'registered_at',
  'paid_at',
  'country',
  'country_code',
  'utm_source',
  'utm_campaign',
  'utm_term',
  'ip',
  'locale',
  'admin_url',
] as const;

export type PaymentTemplateVars = Partial<
  Record<(typeof PAYMENT_TEMPLATE_VARS)[number], string>
>;

export const PAYMENT_TEMPLATES: Record<NotifyLanguage, string> = {
  zh: `【{{app_name}}】{{provider}} 收款成功

扣费类型：{{charge_type}}
{{#billing_cycle}}订阅类型：{{billing_cycle}}
{{/billing_cycle}}套餐：{{plan_name}}
金额：{{amount}}
{{#credits}}购买积分：{{credits}}
{{/credits}}{{#discount_code}}优惠码：{{discount_code}}（原价 {{list_amount}}）
{{/discount_code}}
用户：{{user}}
注册：{{registered_at}}
支付：{{paid_at}}
国家地区：{{country}}
来源：{{utm_source}}
计划：{{utm_campaign}}
关键词：{{utm_term}}
{{#admin_url}}
查看订单：{{admin_url}}{{/admin_url}}`,
  en: `[{{app_name}}] {{provider}} payment received

Charge: {{charge_type}}
{{#billing_cycle}}Billing: {{billing_cycle}}
{{/billing_cycle}}Plan: {{plan_name}}
Amount: {{amount}}
{{#credits}}Credits: {{credits}}
{{/credits}}{{#discount_code}}Coupon: {{discount_code}} (list price {{list_amount}})
{{/discount_code}}
User: {{user}}
Registered: {{registered_at}}
Paid: {{paid_at}}
Country: {{country}}
Source: {{utm_source}}
Campaign: {{utm_campaign}}
Keyword: {{utm_term}}
{{#admin_url}}
View order: {{admin_url}}{{/admin_url}}`,
};

export const TICKET_TEMPLATE_VARS = [
  'event',
  'app_name',
  'title',
  'content',
  'attachments',
  'user',
  'email',
  'user_name',
  'registered_at',
  'created_at',
  'country',
  'admin_url',
] as const;

export type TicketTemplateVars = Partial<
  Record<(typeof TICKET_TEMPLATE_VARS)[number], string>
>;

export const TICKET_TEMPLATES: Record<NotifyLanguage, string> = {
  zh: `【{{app_name}}】{{event}}

标题：{{title}}
内容：{{content}}
{{#attachments}}附件：{{attachments}} 张图片
{{/attachments}}
用户：{{user}}
注册：{{registered_at}}
提交：{{created_at}}
国家地区：{{country}}
{{#admin_url}}
查看工单：{{admin_url}}{{/admin_url}}`,
  en: `[{{app_name}}] {{event}}

Title: {{title}}
Content: {{content}}
{{#attachments}}Attachments: {{attachments}} image(s)
{{/attachments}}
User: {{user}}
Registered: {{registered_at}}
Submitted: {{created_at}}
Country: {{country}}
{{#admin_url}}
View ticket: {{admin_url}}{{/admin_url}}`,
};

export const GUEST_POST_TEMPLATES: Record<NotifyLanguage, string> = {
  zh: `【{{app_name}}】{{event}}

标题：{{title}}
套餐：{{package}}{{#amount}}（{{amount}}）{{/amount}}
作者：{{user}}
注册：{{registered_at}}
提交：{{submitted_at}}
国家地区：{{country}}
{{#preview_url}}
预览文章：{{preview_url}}{{/preview_url}}
{{#admin_url}}
去审核：{{admin_url}}{{/admin_url}}`,
  en: `[{{app_name}}] {{event}}

Title: {{title}}
Package: {{package}}{{#amount}} ({{amount}}){{/amount}}
Author: {{user}}
Registered: {{registered_at}}
Submitted: {{submitted_at}}
Country: {{country}}
{{#preview_url}}
Preview: {{preview_url}}{{/preview_url}}
{{#admin_url}}
Review: {{admin_url}}{{/admin_url}}`,
};

export const GUEST_POST_EVENT_LABELS: Record<
  NotifyLanguage,
  Record<'submitted' | 'resubmitted', string>
> = {
  zh: { submitted: '新投稿待审核', resubmitted: '投稿重新提交' },
  en: {
    submitted: 'Guest post awaiting review',
    resubmitted: 'Guest post resubmitted',
  },
};

export function normalizeNotifyLanguage(value?: string): NotifyLanguage {
  return value === 'en' ? 'en' : 'zh';
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>
): string {
  const sections = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, name: string, inner: string) => (vars[name] ? inner : '')
  );
  return sections
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] || '-')
    .trim();
}
