/**
 * Bot notification channels — Telegram, Feishu (Lark), WeCom, and a generic
 * JSON webhook (AI agents / automations such as a Grok bot or Cursor routine).
 *
 * Plain-text messages over each platform's bot webhook API. Uses only
 * `fetch` + Web Crypto so it runs on Node and Cloudflare Workers alike.
 */

export type NotifyChannel = 'telegram' | 'feishu' | 'wecom' | 'webhook';

export interface NotifyChannelConfig {
  telegram?: { botToken: string; chatId: string; apiBase?: string };
  feishu?: { webhookUrl: string; secret?: string };
  wecom?: { webhookUrl: string };
  webhook?: { url: string; token?: string };
}

/**
 * Structured context for the generic webhook. Chat bots only get the text;
 * the webhook also receives the event name and the raw template variables.
 */
export interface NotifyEvent {
  event: string;
  data: Record<string, string | undefined>;
  test?: boolean;
}

export interface NotifyResult {
  channel: NotifyChannel;
  success: boolean;
  error?: string;
}

const TIMEOUT_MS = 8000;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON body — fall through with raw text in the error
  }
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}: ${data?.description || data?.msg || text.slice(0, 200)}`
    );
  }
  return data;
}

export async function sendTelegram(
  config: NonNullable<NotifyChannelConfig['telegram']>,
  text: string
): Promise<void> {
  const base = (config.apiBase || 'https://api.telegram.org').replace(
    /\/+$/,
    ''
  );
  const data = await postJson(`${base}/bot${config.botToken}/sendMessage`, {
    chat_id: config.chatId,
    text,
    disable_web_page_preview: true,
  });
  if (data && data.ok === false) {
    throw new Error(data.description || 'Telegram API error');
  }
}

async function feishuSign(timestamp: string, secret: string): Promise<string> {
  // Feishu signs an empty message with key = `${timestamp}\n${secret}`.
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new Uint8Array());
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function sendFeishu(
  config: NonNullable<NotifyChannelConfig['feishu']>,
  text: string
): Promise<void> {
  const body: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  };
  if (config.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    body.timestamp = timestamp;
    body.sign = await feishuSign(timestamp, config.secret);
  }
  const data = await postJson(config.webhookUrl, body);
  const code = data?.code ?? data?.StatusCode ?? 0;
  if (code !== 0) {
    throw new Error(data?.msg || data?.StatusMessage || `Feishu code ${code}`);
  }
}

export async function sendWecom(
  config: NonNullable<NotifyChannelConfig['wecom']>,
  text: string
): Promise<void> {
  const data = await postJson(config.webhookUrl, {
    msgtype: 'text',
    text: { content: text },
  });
  if (data && data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg || `WeCom errcode ${data.errcode}`);
  }
}

/**
 * POST `{ event, test, text, data, sent_at }` as JSON, with an optional
 * `Authorization: Bearer <token>`. Any 2xx response counts as delivered.
 */
export async function sendWebhook(
  config: NonNullable<NotifyChannelConfig['webhook']>,
  text: string,
  event?: NotifyEvent
): Promise<void> {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Webhook URL must be http(s)');
  }
  await postJson(
    url.toString(),
    {
      event: event?.event || 'message',
      test: event?.test || false,
      text,
      data: event?.data || {},
      sent_at: new Date().toISOString(),
    },
    config.token ? { Authorization: `Bearer ${config.token}` } : {}
  );
}

/** Send to every configured channel in parallel; never throws. */
export async function sendToChannels(
  config: NotifyChannelConfig,
  text: string,
  event?: NotifyEvent
): Promise<NotifyResult[]> {
  const jobs: [NotifyChannel, () => Promise<void>][] = [];
  if (config.telegram) {
    jobs.push(['telegram', () => sendTelegram(config.telegram!, text)]);
  }
  if (config.feishu) {
    jobs.push(['feishu', () => sendFeishu(config.feishu!, text)]);
  }
  if (config.wecom) {
    jobs.push(['wecom', () => sendWecom(config.wecom!, text)]);
  }
  if (config.webhook) {
    jobs.push(['webhook', () => sendWebhook(config.webhook!, text, event)]);
  }

  return Promise.all(
    jobs.map(async ([channel, run]) => {
      try {
        await run();
        return { channel, success: true };
      } catch (error: any) {
        return {
          channel,
          success: false,
          error: error?.message || String(error),
        };
      }
    })
  );
}
