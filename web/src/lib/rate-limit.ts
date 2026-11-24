type MinIntervalOptions = {
  intervalMs: number;
  keyPrefix?: string;
  extraKey?: string;
  burst?: number;
};

type Store = Map<string, number>;

declare global {
  var __minIntervalRateLimitStore: Store | undefined;
}

// Prefer Cloudflare's unspoofable cf-connecting-ip over x-forwarded-for.
function getClientIpFromRequest(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || '';
  return request.headers.get('x-real-ip') || '';
}

function getStore(): Store {
  if (!globalThis.__minIntervalRateLimitStore) {
    globalThis.__minIntervalRateLimitStore = new Map();
  }
  return globalThis.__minIntervalRateLimitStore;
}

/**
 * Keyed by `extraKey` (pass the session user id once the caller is
 * authenticated) or else the client IP — never by cookies, which a client can
 * vary freely to get a fresh bucket on every request.
 */
function buildKey(request: Request, opts: MinIntervalOptions): string {
  const url = new URL(request.url);
  const who = opts.extraKey
    ? `user:${opts.extraKey}`
    : `ip:${getClientIpFromRequest(request) || 'unknown'}`;
  const prefix = opts.keyPrefix || 'min-interval';
  return `${prefix}|${request.method}|${url.pathname}|${who}`;
}

// Entries only matter for one interval; drop stale ones so a flood of
// distinct IPs can't grow the map without bound.
const MAX_ENTRIES = 10_000;
const STALE_MS = 10 * 60 * 1000;
function prune(store: Store, now: number) {
  if (store.size < MAX_ENTRIES) return;
  for (const [key, at] of store) if (now - at > STALE_MS) store.delete(key);
  if (store.size >= MAX_ENTRIES) store.clear();
}

export function enforceMinIntervalRateLimit(
  request: Request,
  opts: MinIntervalOptions
): Response | null {
  const intervalMs = Math.max(0, Number(opts.intervalMs) || 0);
  if (!intervalMs) return null;
  const now = Date.now();
  const store = getStore();
  const key = buildKey(request, opts);
  const last = store.get(key);
  const burst = Math.max(1, Math.floor(Number(opts.burst) || 1));
  // Reserve one interval per accepted request, allowing a bounded burst.
  // With burst=1 this retains the original minimum-interval behavior.
  const next = Math.max(last ?? now - intervalMs, now - intervalMs) + intervalMs;
  const waitMs = next - now - (burst - 1) * intervalMs;
  if (typeof last === 'number') {
    if (waitMs > 0) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(waitMs / 1000)
      );
      return Response.json(
        {
          error: 'too_many_requests',
          message: `Please retry after ${retryAfterSeconds}s.`,
        },
        {
          status: 429,
          headers: {
            'cache-control': 'no-store',
            'retry-after': String(retryAfterSeconds),
          },
        }
      );
    }
  }
  prune(store, now);
  store.set(key, next);
  return null;
}
