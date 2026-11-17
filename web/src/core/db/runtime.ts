import { envConfigs } from '@/config';

// workerd sets navigator.userAgent — the documented Workers runtime detection.
export const isCloudflareWorker =
  (typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers') ||
  (typeof globalThis !== 'undefined' && 'Cloudflare' in globalThis);

/** Drivers that hold a TCP socket (can't be shared across Workers requests). */
export const TCP_PROVIDERS = ['postgresql', 'postgres', 'mysql'];

/**
 * Connection string from the Workers HYPERDRIVE binding, or '' outside
 * Workers / without the binding. src/server.ts stashes the binding env on
 * globalThis (same pattern as the D1 binding in d1.ts). Configure via
 * wrangler.jsonc: "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "..." }]
 */
export function getHyperdriveConnectionString(): string {
  if (!isCloudflareWorker) return '';
  const g = globalThis as any;
  const env = g.__CF_ENV__ ?? g.__env__;
  return env?.HYPERDRIVE?.connectionString || '';
}

/**
 * Whether a database is reachable — the single answer to "is there a
 * database". With Hyperdrive there is no DATABASE_URL, so checking that alone
 * makes callers (e.g. the settings loader) silently skip the database.
 */
export function hasDatabaseConfigured(): boolean {
  return Boolean(
    envConfigs.database_url ||
    envConfigs.database_provider === 'd1' ||
    getHyperdriveConnectionString()
  );
}
