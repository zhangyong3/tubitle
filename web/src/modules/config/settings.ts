/**
 * Settings definitions — tabs, groups, and fields.
 *
 * This drives the admin settings UI. Add new settings here
 * and they'll automatically appear in the admin panel.
 */

import {
  APPEARANCE_ENABLED_KEY,
  COLOR_MODE_CONFIG_KEY,
  COLOR_MODES,
  DEFAULT_APPEARANCE,
  FONT_SIZES,
  FONTS,
  SIDEBAR_COLLAPSIBLES,
  SIDEBAR_VARIANTS,
  THEMES,
} from '@/config/appearance';
import { USER_FEATURES } from '@/config/user-features';

export interface Setting {
  name: string;
  title: string;
  type: 'text' | 'password' | 'textarea' | 'number' | 'switch' | 'select';
  placeholder?: string;
  options?: { label: string; value: string }[];
  tip?: string;
  group: string;
  tab: string;
  defaultValue?: string;
}

export interface SettingGroup {
  name: string;
  title: string;
  description?: string;
  tab: string;
}

export interface SettingTab {
  name: string;
  title: string;
}

export function getSettingTabs(): SettingTab[] {
  return [
    { name: 'general', title: 'General' },
    { name: 'user', title: 'Users' },
    { name: 'auth', title: 'Auth' },
    { name: 'payment', title: 'Payment' },
    { name: 'email', title: 'Email' },
    { name: 'storage', title: 'Storage' },
    { name: 'ai', title: 'AI' },
    { name: 'analytics', title: 'Analytics' },
    { name: 'ads', title: 'Ads' },
    { name: 'customer_service', title: 'Customer Service' },
    { name: 'notify', title: 'Notify' },
    { name: 'custom', title: 'Custom' },
  ];
}

export function getSettingGroups(): SettingGroup[] {
  return [
    // General
    {
      name: 'appinfo',
      title: 'App Info',
      description: 'Basic application settings',
      tab: 'general',
    },
    {
      name: 'appearance',
      title: 'Appearance',
      description: 'Theme color, font, font size and sidebar layout',
      tab: 'general',
    },

    // Users
    {
      name: 'credit',
      title: 'Credits',
      description: 'Initial credits for new users',
      tab: 'user',
    },
    {
      name: 'user_role',
      title: 'User Roles',
      description: 'Default role for new users',
      tab: 'user',
    },
    {
      name: 'user_features',
      title: 'User Features',
      description: 'Optional pages in the user center',
      tab: 'user',
    },
    {
      name: 'guest_post',
      title: 'Guest Posts',
      description: 'Paid articles from outside authors',
      tab: 'user',
    },

    // Auth
    {
      name: 'email_auth',
      title: 'Email Auth',
      description: 'Email/password authentication',
      tab: 'auth',
    },
    {
      name: 'google_auth',
      title: 'Google Auth',
      description: 'Google OAuth login',
      tab: 'auth',
    },
    {
      name: 'github_auth',
      title: 'GitHub Auth',
      description: 'GitHub OAuth login',
      tab: 'auth',
    },

    // Payment
    {
      name: 'basic_payment',
      title: 'Basic',
      description: 'Payment general settings',
      tab: 'payment',
    },
    {
      name: 'stripe',
      title: 'Stripe',
      description: 'Stripe payment gateway',
      tab: 'payment',
    },
    {
      name: 'creem',
      title: 'Creem',
      description: 'Creem payment gateway',
      tab: 'payment',
    },
    {
      name: 'paypal',
      title: 'PayPal',
      description: 'PayPal payment gateway',
      tab: 'payment',
    },
    {
      name: 'alipay',
      title: 'Alipay',
      description: 'Alipay payment gateway (native)',
      tab: 'payment',
    },
    {
      name: 'wechat',
      title: 'WeChat Pay',
      description: 'WeChat Pay gateway (native)',
      tab: 'payment',
    },

    // Email
    {
      name: 'email_general',
      title: 'General',
      description: 'Email provider selection',
      tab: 'email',
    },
    {
      name: 'resend',
      title: 'Resend',
      description: 'Resend email service',
      tab: 'email',
    },
    {
      name: 'cloudflare_email',
      title: 'Cloudflare Email',
      description: 'Cloudflare Email Service',
      tab: 'email',
    },

    // Storage
    {
      name: 'r2',
      title: 'Cloudflare R2 / S3',
      description: 'Object storage settings',
      tab: 'storage',
    },

    // AI
    {
      name: 'openai',
      title: 'OpenAI',
      description: 'OpenAI (or compatible) API',
      tab: 'ai',
    },
    {
      name: 'anthropic',
      title: 'Anthropic',
      description: 'Anthropic Claude API',
      tab: 'ai',
    },
    {
      name: 'replicate',
      title: 'Replicate',
      description: 'Replicate AI API',
      tab: 'ai',
    },
    { name: 'fal', title: 'Fal', description: 'Fal AI API', tab: 'ai' },

    // Analytics
    {
      name: 'google_analytics',
      title: 'Google Analytics',
      description: 'Inject gtag.js with the configured Measurement ID',
      tab: 'analytics',
    },
    {
      name: 'plausible',
      title: 'Plausible',
      description: 'Inject plausible.js for self-hosted or cloud Plausible',
      tab: 'analytics',
    },
    {
      name: 'cookie_consent',
      title: 'Cookie Consent',
      description:
        'Show a cookie banner to visitors. Until they accept, Google Analytics runs in Consent Mode (no cookies) and the AdSense script is not loaded. Plausible is cookieless and unaffected.',
      tab: 'analytics',
    },

    // Ads
    {
      name: 'adsense',
      title: 'Google AdSense',
      description:
        'Inject the AdSense script sitewide and serve /ads.txt from the configured publisher ID',
      tab: 'ads',
    },

    // Customer Service
    {
      name: 'crisp',
      title: 'Crisp',
      description: 'Crisp live chat widget',
      tab: 'customer_service',
    },
    {
      name: 'tawk',
      title: 'Tawk.to',
      description: 'Tawk.to live chat widget',
      tab: 'customer_service',
    },

    // Notify
    {
      name: 'notify_settings',
      title: 'Notification Settings',
      description: 'Choose which events push a message to the bots below',
      tab: 'notify',
    },
    {
      name: 'notify_telegram',
      title: 'Telegram Bot',
      description: 'Telegram Bot API sendMessage',
      tab: 'notify',
    },
    {
      name: 'notify_feishu',
      title: 'Feishu / Lark Bot',
      description: 'Feishu custom bot webhook',
      tab: 'notify',
    },
    {
      name: 'notify_wecom',
      title: 'WeCom Bot',
      description: 'WeCom (企业微信) group bot webhook',
      tab: 'notify',
    },
    {
      name: 'notify_webhook',
      title: 'Webhook',
      description:
        'POST JSON to any endpoint — AI agents and automations (Grok bot, Cursor routine, Zapier, n8n…)',
      tab: 'notify',
    },
  ];
}

export function getSettings(): Setting[] {
  return [
    // ─── General / App Info ──────────────────────────────────────────
    {
      name: 'app_name',
      title: 'App Name',
      type: 'text',
      placeholder: 'My App',
      group: 'appinfo',
      tab: 'general',
    },
    {
      name: 'app_description',
      title: 'App Description',
      type: 'textarea',
      placeholder: 'Ship your SaaS faster',
      group: 'appinfo',
      tab: 'general',
    },
    {
      name: 'app_url',
      title: 'App URL',
      type: 'text',
      placeholder: 'https://example.com',
      group: 'appinfo',
      tab: 'general',
    },

    // ─── General / Appearance ────────────────────────────────────────
    {
      name: APPEARANCE_ENABLED_KEY,
      title: 'Enable appearance settings',
      type: 'switch',
      group: 'appearance',
      tab: 'general',
    },
    {
      name: COLOR_MODE_CONFIG_KEY,
      title: 'Light / dark',
      type: 'select',
      options: COLOR_MODES.map((c) => ({ label: c.id, value: c.id })),
      group: 'appearance',
      tab: 'general',
      defaultValue: 'system',
    },
    {
      name: 'app_theme',
      title: 'Site theme',
      type: 'select',
      options: THEMES.map((t) => ({ label: t.id, value: t.id })),
      group: 'appearance',
      tab: 'general',
      defaultValue: DEFAULT_APPEARANCE.theme,
    },
    {
      name: 'app_font',
      title: 'Font',
      type: 'select',
      options: FONTS.map((f) => ({ label: f.id, value: f.id })),
      group: 'appearance',
      tab: 'general',
      defaultValue: DEFAULT_APPEARANCE.font,
    },
    {
      name: 'app_font_size',
      title: 'Font size',
      type: 'select',
      options: FONT_SIZES.map((f) => ({ label: f.id, value: f.id })),
      group: 'appearance',
      tab: 'general',
      defaultValue: DEFAULT_APPEARANCE.fontSize,
    },
    {
      name: 'app_sidebar_variant',
      title: 'Sidebar style',
      type: 'select',
      options: SIDEBAR_VARIANTS.map((v) => ({ label: v.id, value: v.id })),
      group: 'appearance',
      tab: 'general',
      defaultValue: DEFAULT_APPEARANCE.sidebarVariant,
    },
    {
      name: 'app_sidebar_collapsible',
      title: 'Sidebar collapse',
      type: 'select',
      options: SIDEBAR_COLLAPSIBLES.map((v) => ({ label: v.id, value: v.id })),
      group: 'appearance',
      tab: 'general',
      defaultValue: DEFAULT_APPEARANCE.sidebarCollapsible,
    },
    {
      name: 'user_theme_enabled',
      title: 'Let users pick their own theme color',
      type: 'switch',
      group: 'appearance',
      tab: 'general',
    },

    // ─── Users / User features ───────────────────────────────────────
    {
      name: 'credits_enabled',
      title: 'Credits',
      type: 'switch',
      group: 'user_features',
      tab: 'user',
      defaultValue: String(USER_FEATURES.credits_enabled),
    },
    {
      name: 'billing_enabled',
      title: 'Billing',
      type: 'switch',
      group: 'user_features',
      tab: 'user',
      defaultValue: String(USER_FEATURES.billing_enabled),
    },
    {
      name: 'payments_enabled',
      title: 'Payments',
      type: 'switch',
      group: 'user_features',
      tab: 'user',
      defaultValue: String(USER_FEATURES.payments_enabled),
    },
    {
      name: 'apikeys_enabled',
      title: 'API keys',
      type: 'switch',
      group: 'user_features',
      tab: 'user',
      defaultValue: String(USER_FEATURES.apikeys_enabled),
    },
    {
      name: 'tickets_enabled',
      title: 'Support tickets',
      type: 'switch',
      group: 'user_features',
      tab: 'user',
      defaultValue: String(USER_FEATURES.tickets_enabled),
    },

    // ─── Users / Guest posts ─────────────────────────────────────────
    {
      name: 'guest_post_enabled',
      title: 'Accept guest posts',
      type: 'switch',
      group: 'guest_post',
      tab: 'user',
    },
    {
      name: 'guest_post_min_words',
      title: 'Minimum words',
      type: 'number',
      placeholder: '300',
      group: 'guest_post',
      tab: 'user',
    },

    // ─── Users / User Roles ──────────────────────────────────────────
    {
      name: 'initial_role_enabled',
      title: 'Auto-assign role for new users',
      type: 'switch',
      group: 'user_role',
      tab: 'user',
    },
    {
      name: 'initial_role_name',
      title: 'Default role name',
      type: 'text',
      placeholder: 'viewer',
      group: 'user_role',
      tab: 'user',
    },

    // ─── Users / Credits ─────────────────────────────────────────────
    {
      name: 'initial_credits_enabled',
      title: 'Grant credits on signup',
      type: 'switch',
      group: 'credit',
      tab: 'user',
    },
    {
      name: 'initial_credits_amount',
      title: 'Credits amount',
      type: 'number',
      placeholder: '100',
      group: 'credit',
      tab: 'user',
    },
    {
      name: 'initial_credits_valid_days',
      title: 'Valid days',
      type: 'number',
      placeholder: '365',
      group: 'credit',
      tab: 'user',
    },
    {
      name: 'initial_credits_description',
      title: 'Description',
      type: 'text',
      placeholder: 'Welcome bonus',
      group: 'credit',
      tab: 'user',
    },

    // ─── Auth / Email ────────────────────────────────────────────────
    {
      name: 'email_auth_enabled',
      title: 'Enable email auth',
      type: 'switch',
      group: 'email_auth',
      tab: 'auth',
      defaultValue: 'true',
    },
    {
      name: 'email_verification_enabled',
      title: 'Require email verification on sign up',
      type: 'switch',
      group: 'email_auth',
      tab: 'auth',
      defaultValue: 'false',
    },
    {
      name: 'invite_code_required',
      title: 'Require invite code on sign up',
      type: 'switch',
      group: 'email_auth',
      tab: 'auth',
      defaultValue: 'false',
    },
    {
      name: 'desktop_auth_schemes',
      title: 'Desktop hand-off schemes',
      type: 'text',
      placeholder: 'myapp,myapp-dev',
      group: 'email_auth',
      tab: 'auth',
    },

    // ─── Auth / Google ───────────────────────────────────────────────
    {
      name: 'google_auth_enabled',
      title: 'Enable Google auth',
      type: 'switch',
      group: 'google_auth',
      tab: 'auth',
    },
    {
      name: 'google_one_tap_enabled',
      title: 'Enable Google One Tap',
      type: 'switch',
      group: 'google_auth',
      tab: 'auth',
      tip: 'Show the Google One Tap prompt to signed-out visitors. Requires Client ID.',
    },
    {
      name: 'google_client_id',
      title: 'Client ID',
      type: 'text',
      placeholder: 'xxx.apps.googleusercontent.com',
      group: 'google_auth',
      tab: 'auth',
    },
    {
      name: 'google_client_secret',
      title: 'Client Secret',
      type: 'password',
      placeholder: 'GOCSPX-xxx',
      group: 'google_auth',
      tab: 'auth',
    },

    // ─── Auth / GitHub ───────────────────────────────────────────────
    {
      name: 'github_auth_enabled',
      title: 'Enable GitHub auth',
      type: 'switch',
      group: 'github_auth',
      tab: 'auth',
    },
    {
      name: 'github_client_id',
      title: 'Client ID',
      type: 'text',
      placeholder: 'Ov23xxx',
      group: 'github_auth',
      tab: 'auth',
    },
    {
      name: 'github_client_secret',
      title: 'Client Secret',
      type: 'password',
      placeholder: 'xxx',
      group: 'github_auth',
      tab: 'auth',
    },

    // ─── Payment / Basic ─────────────────────────────────────────────
    {
      name: 'select_payment_enabled',
      title: 'Show payment method selector',
      type: 'switch',
      group: 'basic_payment',
      tab: 'payment',
    },
    {
      name: 'default_payment_provider',
      title: 'Default provider',
      type: 'select',
      options: [
        { label: 'Stripe', value: 'stripe' },
        { label: 'Creem', value: 'creem' },
        { label: 'PayPal', value: 'paypal' },
        { label: 'Alipay', value: 'alipay' },
        { label: 'WeChat Pay', value: 'wechat' },
      ],
      group: 'basic_payment',
      tab: 'payment',
    },

    // ─── Payment / Stripe ────────────────────────────────────────────
    {
      name: 'stripe_enabled',
      title: 'Enable Stripe',
      type: 'switch',
      group: 'stripe',
      tab: 'payment',
    },
    {
      name: 'stripe_publishable_key',
      title: 'Publishable Key',
      type: 'text',
      placeholder: 'pk_xxx',
      group: 'stripe',
      tab: 'payment',
    },
    {
      name: 'stripe_secret_key',
      title: 'Secret Key',
      type: 'password',
      placeholder: 'sk_xxx',
      group: 'stripe',
      tab: 'payment',
    },
    {
      name: 'stripe_signing_secret',
      title: 'Webhook Signing Secret',
      type: 'password',
      placeholder: 'whsec_xxx',
      group: 'stripe',
      tab: 'payment',
    },

    // ─── Payment / Creem ─────────────────────────────────────────────
    {
      name: 'creem_enabled',
      title: 'Enable Creem',
      type: 'switch',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_environment',
      title: 'Environment',
      type: 'select',
      options: [
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Production', value: 'production' },
      ],
      group: 'creem',
      tab: 'payment',
      defaultValue: 'sandbox',
    },
    {
      name: 'creem_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'creem_xxx',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_signing_secret',
      title: 'Signing Secret',
      type: 'password',
      placeholder: 'whsec_xxx',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_product_ids_mapping',
      title: 'Product IDs Mapping',
      type: 'textarea',
      placeholder: '{"starter_monthly": "prod_xxx"}',
      tip: 'Map the product_id in pricing catalog to the product ID created in Creem. Must be a valid JSON object.',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_test_amount',
      title: 'Test amount (cents)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 $0.01',
      group: 'creem',
      tab: 'payment',
    },

    // ─── Payment / PayPal ────────────────────────────────────────────
    {
      name: 'paypal_enabled',
      title: 'Enable PayPal',
      type: 'switch',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_client_id',
      title: 'Client ID',
      type: 'text',
      placeholder: 'xxx',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_client_secret',
      title: 'Client Secret',
      type: 'password',
      placeholder: 'xxx',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_webhook_id',
      title: 'Webhook ID',
      type: 'text',
      placeholder: 'xxx',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_environment',
      title: 'Environment',
      type: 'select',
      options: [
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Live', value: 'live' },
      ],
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_test_amount',
      title: 'Test amount (cents)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 $0.01',
      group: 'paypal',
      tab: 'payment',
    },

    // ─── Payment / Alipay ─────────────────────────────────────────────
    {
      name: 'alipay_enabled',
      title: 'Enable Alipay',
      type: 'switch',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_app_id',
      title: 'App ID',
      type: 'text',
      placeholder: '2021xxx',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_private_key',
      title: 'Private Key (RSA2)',
      type: 'textarea',
      placeholder: 'MIIEvQIBADANBgkq...',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_public_key',
      title: 'Alipay Public Key',
      type: 'textarea',
      placeholder: 'MIIBIjANBgkq...',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_notify_url',
      title: 'Notify URL (Webhook)',
      type: 'text',
      placeholder: 'https://hersoul.cn/api/payment/notify/alipay',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_test_amount',
      title: 'Test amount (分)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 ¥0.01',
      group: 'alipay',
      tab: 'payment',
    },

    // ─── Payment / WeChat Pay ───────────────────────────────────────
    {
      name: 'wechat_enabled',
      title: 'Enable WeChat Pay',
      type: 'switch',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_app_id',
      title: 'AppID',
      type: 'text',
      placeholder: 'wx1234567890',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_mch_id',
      title: 'Merchant ID (商户号)',
      type: 'text',
      placeholder: '1900000001',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_api_v3_key',
      title: 'APIv3 Key (32位密钥)',
      type: 'password',
      placeholder: '32 chars',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_private_key',
      title: 'Merchant Private Key (PEM)',
      type: 'textarea',
      placeholder: 'MIIEvgIBADANBgkq...',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_serial_no',
      title: 'Certificate Serial No',
      type: 'text',
      placeholder: 'xxx',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_notify_url',
      title: 'Notify URL (Webhook)',
      type: 'text',
      placeholder: 'https://hersoul.cn/api/payment/notify/wechat',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_test_amount',
      title: 'Test amount (分)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 ¥0.01',
      group: 'wechat',
      tab: 'payment',
    },

    // ─── Email / General ────────────────────────────────────────────
    {
      name: 'email_provider',
      title: 'Email Provider',
      type: 'select',
      options: [
        { label: 'Resend', value: 'resend' },
        { label: 'Cloudflare Email', value: 'cloudflare' },
      ],
      group: 'email_general',
      tab: 'email',
      defaultValue: 'resend',
    },

    // ─── Email / Resend ──────────────────────────────────────────────
    {
      name: 'resend_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 're_xxx',
      group: 'resend',
      tab: 'email',
    },
    {
      name: 'resend_sender_email',
      title: 'Sender Email',
      type: 'text',
      placeholder: 'hello@example.com',
      group: 'resend',
      tab: 'email',
    },

    // ─── Email / Cloudflare Email ────────────────────────────────────
    {
      name: 'cloudflare_email_api_token',
      title: 'API Token',
      type: 'password',
      placeholder: 'Bearer token with Email Send permission',
      group: 'cloudflare_email',
      tab: 'email',
    },
    {
      name: 'cloudflare_email_account_id',
      title: 'Account ID',
      type: 'text',
      placeholder: 'Cloudflare account ID',
      group: 'cloudflare_email',
      tab: 'email',
    },
    {
      name: 'cloudflare_email_sender_email',
      title: 'Sender Email',
      type: 'text',
      placeholder: 'hello@yourdomain.com',
      group: 'cloudflare_email',
      tab: 'email',
    },

    // ─── Storage / R2 ────────────────────────────────────────────────
    // Keys mirror the original ShipAny Two (`r2_*`) so existing DB config is read as-is.
    {
      name: 'r2_access_key',
      title: 'Cloudflare Access Key',
      type: 'text',
      placeholder: '',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_secret_key',
      title: 'Cloudflare Secret Key',
      type: 'password',
      placeholder: '',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_bucket_name',
      title: 'Bucket Name',
      type: 'text',
      placeholder: '',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_upload_path',
      title: 'Upload Path',
      type: 'text',
      placeholder: 'uploads',
      tip: 'Path to upload files to; leave empty to use the default. Example: uploads/foo/bar',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_endpoint',
      title: 'Endpoint',
      type: 'text',
      placeholder: 'https://<account-id>.r2.cloudflarestorage.com',
      tip: 'Leave empty to use the default R2 endpoint',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_domain',
      title: 'Domain',
      type: 'text',
      placeholder: 'https://cdn.example.com',
      group: 'r2',
      tab: 'storage',
    },

    // ─── AI / OpenAI ─────────────────────────────────────────────────
    {
      name: 'openai_base_url',
      title: 'Base URL',
      type: 'text',
      placeholder: 'https://api.openai.com/v1',
      group: 'openai',
      tab: 'ai',
    },
    {
      name: 'openai_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'sk-xxx',
      group: 'openai',
      tab: 'ai',
    },

    { name: 'openai_model', title: 'Sentence analysis model', type: 'text', group: 'openai', tab: 'ai', tip: 'Required model ID for Tubitle sentence analysis. Daily quota: Free 3, Pro 100.' },

    // ─── AI / Anthropic ──────────────────────────────────────────────
    {
      name: 'anthropic_base_url',
      title: 'Base URL',
      type: 'text',
      placeholder: 'https://api.anthropic.com',
      group: 'anthropic',
      tab: 'ai',
    },
    {
      name: 'anthropic_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'sk-ant-xxx',
      group: 'anthropic',
      tab: 'ai',
    },

    // ─── AI / Replicate ──────────────────────────────────────────────
    {
      name: 'replicate_api_token',
      title: 'API Token',
      type: 'password',
      placeholder: 'r8_xxx',
      group: 'replicate',
      tab: 'ai',
    },

    // ─── AI / Fal ────────────────────────────────────────────────────
    {
      name: 'fal_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'xxx',
      group: 'fal',
      tab: 'ai',
    },

    // ─── Analytics / Google Analytics ────────────────────────────────
    {
      name: 'google_analytics_id',
      title: 'Measurement ID',
      type: 'text',
      placeholder: 'G-XXXXXXXXXX',
      group: 'google_analytics',
      tab: 'analytics',
    },

    // ─── Analytics / Plausible ───────────────────────────────────────
    {
      name: 'plausible_domain',
      title: 'Domain',
      type: 'text',
      placeholder: 'example.com',
      tip: 'Optional for the new site-specific script; required by legacy scripts',
      group: 'plausible',
      tab: 'analytics',
    },
    {
      name: 'plausible_src',
      title: 'Script Src',
      type: 'text',
      placeholder: 'https://plausible.example.com/js/pa-XXXXX.js',
      tip: 'Paste the complete site-specific script URL from Plausible, or leave blank to use the legacy cloud script. Accepts a same-site proxy path (e.g. /js/script.js) or an https URL on plausible.io; a self-hosted domain must be listed in the server env PLAUSIBLE_SCRIPT_HOSTS (restart or redeploy, no rebuild)',
      group: 'plausible',
      tab: 'analytics',
    },

    // ─── Analytics / Cookie Consent ──────────────────────────────────
    {
      name: 'cookie_consent_enabled',
      title: 'Enable Cookie Banner',
      type: 'switch',
      tip: 'Recommended if you serve visitors in the EU/UK and use Google Analytics or AdSense',
      group: 'cookie_consent',
      tab: 'analytics',
    },

    // ─── Ads / Google AdSense ────────────────────────────────────────
    {
      name: 'adsense_code',
      title: 'Publisher ID',
      type: 'text',
      placeholder: 'ca-pub-XXXXXXXXXXXXXXXX',
      tip: 'Your AdSense publisher ID — also used to generate /ads.txt',
      group: 'adsense',
      tab: 'ads',
    },

    // ─── Customer Service / Crisp ───────────────────────────────────
    {
      name: 'crisp_enabled',
      title: 'Enable Crisp',
      type: 'switch',
      group: 'crisp',
      tab: 'customer_service',
    },
    {
      name: 'crisp_website_id',
      title: 'Website ID',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      group: 'crisp',
      tab: 'customer_service',
    },

    // ─── Customer Service / Tawk.to ─────────────────────────────────
    {
      name: 'tawk_enabled',
      title: 'Enable Tawk.to',
      type: 'switch',
      group: 'tawk',
      tab: 'customer_service',
    },
    {
      name: 'tawk_property_id',
      title: 'Property ID',
      type: 'text',
      placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx',
      group: 'tawk',
      tab: 'customer_service',
    },
    {
      name: 'tawk_widget_id',
      title: 'Widget ID',
      type: 'text',
      placeholder: '1xxxxx/default',
      group: 'tawk',
      tab: 'customer_service',
    },

    // ─── Notify / Settings (events + shared message options) ─────────
    {
      name: 'notify_payment_enabled',
      title: 'Successful payment',
      type: 'switch',
      group: 'notify_settings',
      tab: 'notify',
      defaultValue: 'false',
    },
    {
      name: 'notify_ticket_enabled',
      title: 'Tickets',
      type: 'switch',
      group: 'notify_settings',
      tab: 'notify',
      defaultValue: 'false',
    },
    {
      name: 'notify_guest_post_enabled',
      title: 'Guest posts',
      type: 'switch',
      group: 'notify_settings',
      tab: 'notify',
      // On by default: a new submission is money waiting for review.
      defaultValue: 'true',
    },
    {
      name: 'notify_language',
      title: 'Message language',
      type: 'select',
      options: [
        { label: '中文', value: 'zh' },
        { label: 'English', value: 'en' },
      ],
      group: 'notify_settings',
      tab: 'notify',
      defaultValue: 'zh',
    },
    {
      name: 'notify_timezone',
      title: 'Time zone',
      type: 'text',
      placeholder: 'Asia/Shanghai',
      group: 'notify_settings',
      tab: 'notify',
    },

    // ─── Notify / Telegram ───────────────────────────────────────────
    {
      name: 'telegram_bot_token',
      title: 'Bot Token',
      type: 'password',
      placeholder: '123456789:AAxxxxxxxx',
      group: 'notify_telegram',
      tab: 'notify',
    },
    {
      name: 'telegram_chat_id',
      title: 'Chat ID',
      type: 'text',
      placeholder: '-1001234567890',
      group: 'notify_telegram',
      tab: 'notify',
    },
    {
      name: 'telegram_api_base',
      title: 'API Base URL',
      type: 'text',
      placeholder: 'https://api.telegram.org',
      group: 'notify_telegram',
      tab: 'notify',
    },

    // ─── Notify / Feishu ─────────────────────────────────────────────
    {
      name: 'feishu_webhook_url',
      title: 'Webhook URL',
      type: 'password',
      placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
      group: 'notify_feishu',
      tab: 'notify',
    },
    {
      name: 'feishu_secret',
      title: 'Signing Secret',
      type: 'password',
      group: 'notify_feishu',
      tab: 'notify',
    },

    // ─── Notify / WeCom ──────────────────────────────────────────────
    {
      name: 'wecom_webhook_url',
      title: 'Webhook URL',
      type: 'password',
      placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx',
      group: 'notify_wecom',
      tab: 'notify',
    },

    // ─── Notify / Generic webhook ────────────────────────────────────
    {
      name: 'notify_webhook_url',
      title: 'Webhook URL',
      type: 'password',
      placeholder: 'https://example.com/hooks/xxx',
      group: 'notify_webhook',
      tab: 'notify',
    },
    {
      name: 'notify_webhook_token',
      title: 'Bearer Token',
      type: 'password',
      group: 'notify_webhook',
      tab: 'notify',
    },
  ];
}
