import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getHyperdriveConnectionString, isCloudflareWorker } from './runtime';
import type { DbConfig } from './types';

// Global database connection instance (singleton pattern)
let dbInstance: ReturnType<typeof drizzle> | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function createPostgresDb(config: DbConfig) {
  let databaseUrl = config.database_url;

  const schemaName = (config.db_schema || 'public').trim();
  const connectionSchemaOptions =
    schemaName && schemaName !== 'public'
      ? { connection: { options: `-c search_path=${schemaName}` } }
      : {};

  // Prefer the Hyperdrive binding on Workers — direct Workers→Postgres pays a
  // full TCP+TLS+auth handshake per connection; Hyperdrive pools at the edge.
  databaseUrl = getHyperdriveConnectionString() || databaseUrl;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  // In Cloudflare Workers, one client per request (db() caches it in the
  // request scope). Options follow Cloudflare's Hyperdrive + postgres.js
  // guidance. No explicit end(): SSR responses stream and deferred loaders
  // may still query after fetch() returns; workerd closes the request's
  // sockets when it finishes.
  if (isCloudflareWorker) {
    const client = postgres(databaseUrl, {
      // Workers allow at most 6 concurrent outbound connections per request.
      max: 5,
      // Skip the pg_type lookup on every new connection (an origin round
      // trip). Safe while the schema has no array columns — re-check if you
      // add one.
      fetch_types: false,
      // Hyperdrive supports prepared statements; prepare:false can make
      // queries hang or fail intermittently there. (The Node branches below
      // keep prepare:false for pgbouncer/Supabase transaction poolers.)
      prepare: true,
      idle_timeout: 10,
      connect_timeout: 5,
      ...connectionSchemaOptions,
    });

    return drizzle(client);
  }

  // Singleton mode: reuse existing connection
  if (config.db_singleton_enabled === 'true') {
    if (dbInstance) {
      return dbInstance;
    }

    client = postgres(databaseUrl, {
      prepare: false,
      max: Number(config.db_max_connections) || 1,
      idle_timeout: 30,
      connect_timeout: 10,
      ...connectionSchemaOptions,
    });

    dbInstance = drizzle({ client });
    return dbInstance;
  }

  // Non-singleton mode: create new connection each time
  const serverlessClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ...connectionSchemaOptions,
  });

  return drizzle({ client: serverlessClient });
}

export async function closePostgresDb(config: DbConfig) {
  if (config.db_singleton_enabled && client) {
    await client.end();
    client = null;
    dbInstance = null;
  }
}
