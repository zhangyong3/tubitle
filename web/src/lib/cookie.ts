export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || '';
  }
  return '';
}

export function setCookie(name: string, value: string, days?: number): void {
  if (typeof document === 'undefined') return;
  let expires = '';
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = `; expires=${date.toUTCString()}`;
  }
  document.cookie = `${name}=${value}${expires}; path=/`;
}

export function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

export function getCookieFromHeader(
  cookieHeader: string | null | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return undefined;
}

export function getHeaderValue(
  ctx: any,
  headerName: string
): string | undefined {
  const h = ctx?.headers ?? ctx?.request?.headers;
  if (!h) return undefined;
  if (typeof h.get === 'function') {
    return h.get(headerName) ?? undefined;
  }
  if (typeof h === 'object') {
    return h[headerName] ?? h[headerName.toLowerCase()] ?? undefined;
  }
  return undefined;
}

export function getCookieFromCtx(ctx: any, name: string): string | undefined {
  if (typeof ctx?.getCookie === 'function') {
    const v = ctx.getCookie(name);
    if (typeof v === 'string') return v;
  }
  const cookieHeader = getHeaderValue(ctx, 'cookie');
  return getCookieFromHeader(cookieHeader, name);
}

// cf-connecting-ip is set by Cloudflare and can't be spoofed by the client;
// the first x-forwarded-for entry can. Prefer it, fall back for other hosts.
export function getClientIpFromCtx(ctx: any): string {
  const cfIp = getHeaderValue(ctx, 'cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = getHeaderValue(ctx, 'x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return getHeaderValue(ctx, 'x-real-ip') || '';
}

/**
 * Keep letters (any script), digits, spaces and `._-` — enough for campaign
 * names and search keywords, nothing that could break a cookie or a message.
 */
export function sanitizeUtm(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export const REFERRER_COOKIE = 'first_referrer';

/**
 * Normalize an external referrer to `origin + pathname` (query/hash dropped —
 * they can carry tokens or PII). Returns '' for non-http(s) referrers and for
 * `selfHosts` (internal navigation). Also re-validates the cookie at sign-up.
 */
export function sanitizeReferrer(
  value: string,
  selfHosts: string[] = []
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (selfHosts.includes(url.host)) return '';
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}${path}`.slice(0, 500);
}

/**
 * ISO 3166-1 alpha-2 country code from the edge/CDN geo header, or '' when
 * not behind one (e.g. localhost). Cloudflare, Vercel and CloudFront supported.
 */
export function getCountryFromCtx(ctx: any): string {
  const code =
    getHeaderValue(ctx, 'cf-ipcountry') ||
    getHeaderValue(ctx, 'x-vercel-ip-country') ||
    getHeaderValue(ctx, 'cloudfront-viewer-country') ||
    '';
  const normalized = code.trim().toUpperCase();
  // Cloudflare uses XX (unknown) and T1 (Tor) as sentinels.
  return /^[A-Z]{2}$/.test(normalized) && normalized !== 'XX' ? normalized : '';
}

export function guessLocaleFromAcceptLanguage(
  acceptLanguage: string | undefined
) {
  if (!acceptLanguage) return '';
  const first = acceptLanguage.split(',')[0]?.trim() ?? '';
  const lang = first.split('-')[0]?.trim() ?? '';
  return lang.replace(/[^\w-]/g, '').slice(0, 10);
}
