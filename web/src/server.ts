import handler from '@tanstack/react-start/server-entry';

import { envConfigs } from './config';
import { runWithDbScope } from './core/db/request-scope';
import {
  getCookieFromHeader,
  REFERRER_COOKIE,
  sanitizeReferrer,
  sanitizeUtm,
} from './lib/cookie';
import { paraglideMiddleware } from './paraglide/server.js';

// On Cloudflare Workers, stash the binding env (D1, ASSETS, …) on globalThis
// so synchronous code paths (e.g. the db() singleton with DATABASE_PROVIDER=d1)
// can reach bindings without threading the request context through every call.
// The specifier is kept non-literal so bundlers leave the import to runtime;
// outside workerd the import rejects and we just move on.
const CF_WORKERS_MODULE = 'cloudflare:workers';
let cfEnvPromise: Promise<void> | null = null;

function ensureCloudflareEnv(): Promise<void> {
  if (!cfEnvPromise) {
    cfEnvPromise = import(/* @vite-ignore */ CF_WORKERS_MODULE)
      .then((mod) => {
        (globalThis as any).__CF_ENV__ = mod.env;
        ensureDefaultUserAgent();
      })
      .catch(() => {
        // Not running on Cloudflare Workers — nothing to stash.
      });
  }
  return cfEnvPromise;
}

// Cloudflare Workers' fetch sends no User-Agent, while Node's adds one. Some
// APIs reject UA-less requests (GitHub → 403, WeChat Pay v3 → 400), so on
// Workers give every outbound request a default UA unless it sets its own.
let fetchPatched = false;

function ensureDefaultUserAgent() {
  if (fetchPatched) return;
  fetchPatched = true;
  const nativeFetch = globalThis.fetch;
  const userAgent = `${envConfigs.app_name || 'ShipAny'} (+${envConfigs.app_url})`;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (headers.has('user-agent')) return nativeFetch(input, init);
    headers.set('user-agent', userAgent);
    return nativeFetch(input, { ...init, headers });
  }) as typeof fetch;
}

const UTM_COOKIE_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];
const ATTRIBUTION_COOKIE_ATTRS = 'Max-Age=2592000; Path=/; SameSite=Lax';

// Behind a proxy req.url can carry an internal host, so also treat the public
// app URL as "self" when filtering referrers.
function appHost(): string {
  try {
    return new URL(envConfigs.app_url).host;
  } catch {
    return '';
  }
}

// Identifies the stack, like WordPress's generator tag (see also the
// generator <meta> in __root.tsx). Not a link; adds no SEO value.
// Response.redirect() and fetched responses have immutable headers: copy
// those, which also lets the cookie writes below succeed.
function withPoweredBy(response: Response): Response {
  try {
    if (!response.headers.has('X-Powered-By')) {
      response.headers.set('X-Powered-By', 'ShipAny');
    }
    return response;
  } catch {
    const copy = new Response(response.body, response);
    if (!copy.headers.has('X-Powered-By')) {
      copy.headers.set('X-Powered-By', 'ShipAny');
    }
    return copy;
  }
}

// Custom server entry — wraps every request in a db scope (one db client per
// request on Workers, see core/db/request-scope.ts) and Paraglide's middleware
// so getLocale() resolves per-request (AsyncLocalStorage) during SSR.
export default {
  async fetch(req: Request): Promise<Response> {
    await ensureCloudflareEnv();
    // Wrap the whole request so anything before/after the handler shares
    // the same db client too.
    return runWithDbScope(() => handleRequest(req));
  },
};

async function handleRequest(req: Request): Promise<Response> {
  const response = withPoweredBy(
    await paraglideMiddleware(req, () => handler.fetch(req))
  );
  // First-touch attribution: remember UTM params for 30 days so sign-up can
  // stamp them onto the user row. Never overwrite an existing cookie.
  const params = new URL(req.url).searchParams;
  const cookieHeader = req.headers.get('cookie');
  for (const key of UTM_COOKIE_KEYS) {
    const value = params.get(key);
    if (!value || getCookieFromHeader(cookieHeader, key)) continue;
    const sanitized = sanitizeUtm(value);
    if (sanitized) {
      response.headers.append(
        'Set-Cookie',
        `${key}=${encodeURIComponent(sanitized)}; ${ATTRIBUTION_COOKIE_ATTRS}`
      );
    }
  }
  // First-touch referrer: only page navigations arriving from another site.
  // Browsers usually trim cross-site referrers to the origin, which is fine.
  const referer = req.headers.get('referer');
  if (
    referer &&
    req.method === 'GET' &&
    (req.headers.get('accept') || '').includes('text/html') &&
    !getCookieFromHeader(cookieHeader, REFERRER_COOKIE)
  ) {
    const sanitized = sanitizeReferrer(referer, [
      new URL(req.url).host,
      appHost(),
    ]);
    if (sanitized) {
      response.headers.append(
        'Set-Cookie',
        `${REFERRER_COOKIE}=${encodeURIComponent(sanitized)}; ${ATTRIBUTION_COOKIE_ATTRS}`
      );
    }
  }
  return response;
}
