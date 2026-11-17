import type { ClientEventKind, EventDetail } from '@/config/events';

/**
 * Report a product event from the browser, e.g.
 * `track('paywall_hit', { feature: 'hd_export' })`. The kind must be
 * registered with `client: true` in src/config/events.ts.
 *
 * Fire-and-forget: never throws, never blocks, and survives a navigation
 * that follows right after (keepalive). Signed-out visitors are ignored by
 * the server.
 */
export function track(kind: ClientEventKind, detail?: EventDetail): void {
  if (typeof window === 'undefined') return;
  try {
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, detail }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch {
    // tracking must never break the page
  }
}
