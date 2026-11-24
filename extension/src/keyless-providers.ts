import { decodeTextEntities } from './shared/text-entities';
import { languageFamily, providerLanguage } from './shared/languages';
import type { TranslationProvider } from './shared/types';

function language(code: string, provider: TranslationProvider) {
  if (!code) return 'auto';
  const zh = languageFamily(code) === 'zh';
  const traditional = /tw|hant|hk/i.test(code);
  if (provider === 'baidu-free') return zh ? (traditional ? 'cht' : 'zh') : ({ ja: 'jp', ko: 'kor', fr: 'fra', es: 'spa', ar: 'ara', vi: 'vie' } as Record<string, string>)[languageFamily(code)] || languageFamily(code);
  if (provider === 'deepl-free') return zh ? 'ZH' : languageFamily(code).toUpperCase();
  return providerLanguage(code, provider === 'edge-free' ? 'microsoft' : 'google');
}
export function keylessRequest(provider: TranslationProvider, text: string, source: string, target: string): { url: string; init: RequestInit } {
  if (!text.trim() || text.length > 1200) throw new Error('字幕文本必须为 1–1200 个字符');
  if (provider === 'tencent-free' && languageFamily(target) === 'zh' && /tw|hant|hk/i.test(target)) throw new Error('腾讯免 Key 翻译不支持繁体中文，请切换引擎');
  const from = language(source, provider), to = language(target, provider);
  let url: string, body: unknown;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'edge-free') {
    url = `https://edge.microsoft.com/translate/translatetext?${new URLSearchParams({from: source ? from : '', to, isEnterpriseClient: 'false'})}`;
    body = [text];
  } else if (provider === 'google-free') {
    url = `https://translate.googleapis.com/translate_a/single?${new URLSearchParams({client: 'gtx', sl: from, tl: to, dt: 't', dj: '1', q: text})}`;
    return { url, init: { method: 'GET', credentials: 'omit', redirect: 'error' } };
  } else if (provider === 'volcengine-free') {
    url = 'https://translate.volcengine.com/crx/translate/v1/';
    body = { source_language: source ? languageFamily(source) : 'auto', target_language: languageFamily(target) === 'zh' ? (/tw|hant|hk/i.test(target) ? 'zh-Hant' : 'zh') : languageFamily(target), text };
  } else if (provider === 'tencent-free') {
    url = 'https://transmart.qq.com/api/imt';
    body = { header: { fn: 'auto_translation', client_key: `browser-chrome-${crypto.randomUUID()}-${Date.now()}` }, type: 'plain', model_category: 'normal', source: { text_list: [text], lang: source ? languageFamily(source) : 'auto' }, target: { lang: languageFamily(target) === 'zh' ? (/tw|hant|hk/i.test(target) ? 'zh-tw' : 'zh') : languageFamily(target) } };
  } else if (provider === 'baidu-free') {
    url = 'https://fanyi.baidu.com/transapi';
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return { url, init: { method: 'POST', headers, body: new URLSearchParams({from, to, query: text, source: 'txt'}).toString(), credentials: 'omit', redirect: 'error' } };
  } else if (provider === 'deepl-free') {
    url = 'https://www2.deepl.com/jsonrpc';
    const divisor = (text.match(/i/g)?.length || 0) + 1;
    const timestamp = Date.now();
    body = { jsonrpc: '2.0', method: 'LMT_handle_texts', id: Math.floor(Math.random() * 1e8), params: { splitting: 'newlines', lang: { target_lang: to, source_lang_user_selected: source ? from : 'auto' }, commonJobParams: { wasSpoken: false, transcribe_as: '', ...(languageFamily(target) === 'zh' ? { regionalVariant: /tw|hant|hk/i.test(target) ? 'zh-Hant' : 'zh-Hans' } : {}) }, timestamp: timestamp + divisor - timestamp % divisor, texts: [{ text, requestAlternatives: 0 }] } };
  } else throw new Error('不支持的免 Key 翻译引擎');
  return { url, init: { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', redirect: 'error' } };
}
export function keylessResult(provider: TranslationProvider, data: any): string {
  let value: unknown;
  if (provider === 'edge-free') value = data?.[0]?.translations?.[0]?.text;
  if (provider === 'google-free') value = data?.sentences?.map((s: any) => typeof s.trans === 'string' ? s.trans : '').join('');
  if (provider === 'volcengine-free') value = data?.translation;
  if (provider === 'tencent-free') value = data?.auto_translation?.join('');
  if (provider === 'baidu-free') {
    if (data?.type === 1 && typeof data.result === 'string') {
      try { value = Object.keys(JSON.parse(data.result)?.content?.[0]?.mean?.[0]?.cont || {})[0]; } catch { /* invalid payload is rejected below */ }
    } else value = data?.data?.map((s: any) => s.dst || '').join('\n');
  }
  if (provider === 'deepl-free') {
    value = data?.result?.texts?.[0]?.text;
    if (typeof value === 'string' && value.startsWith("You're using an older version of DeepL.")) throw new Error('DeepL 已停止支持此客户端协议，请切换翻译引擎');
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) throw new Error('翻译服务未返回有效译文，请切换引擎后重试');
  return decodeTextEntities(value.trim());
}
let tail: Promise<unknown> = Promise.resolve();
let nextStart = 0;
export function translateKeyless(provider: TranslationProvider, text: string, source: string, target: string, signal?: AbortSignal): Promise<string> {
  const task = tail.catch(() => undefined).then(async () => {
    signal?.throwIfAborted();
    const delay = Math.max(0, nextStart - Date.now());
    if (delay) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    nextStart = Date.now() + 300;
    const { url, init } = keylessRequest(provider, text, source, target);
    const response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 429 ? '翻译服务请求过于频繁，请稍后重试或切换引擎（429）' : `翻译服务暂不可用（${response.status}），请切换引擎后重试`);
    return keylessResult(provider, await response.json());
  });
  tail = task;
  return task;
}
