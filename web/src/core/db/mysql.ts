import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2';

import { getHyperdriveConnectionString, isCloudflareWorker } from './runtime';
import type { DbConfig } from './types';

// Global database connection instance (singleton pattern)
let dbInstance: ReturnType<typeof drizzle> | null = null;
let pool: ReturnType<typeof mysql.createPool> | null = null;

export function createMysqlDb(config: DbConfig) {
  // Prefer the Hyperdrive binding on Workers (stashed on globalThis by
  // src/server.ts).
  const databaseUrl = getHyperdriveConnectionString() || config.database_url;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  // In Cloudflare Workers, one connection per request (db() caches it in the
  // request scope).
  if (isCloudflareWorker) {
    const client = mysql.createConnection({
      uri: databaseUrl,
      connectionLimit: 1,
      enableKeepAlive: true,
      waitForConnections: true,
    });

    return drizzle({ client });
  }

  // Singleton mode
  if (config.db_singleton_enabled === 'true') {
    if (dbInstance) {
      return dbInstance;
    }

    pool = mysql.createPool({
      uri: databaseUrl,
      connectionLimit: Number(config.db_max_connections) || 1,
      enableKeepAlive: true,
      waitForConnections: true,
    });

    dbInstance = drizzle({ client: pool });
    return dbInstance;
  }

  // Non-singleton mode
  const serverlessClient = mysql.createConnection({
    uri: databaseUrl,
    connectionLimit: 1,
    enableKeepAlive: true,
    waitForConnections: true,
  });

  return drizzle(serverlessClient);
}

export async function closeMysqlDb(config: DbConfig) {
  if (config.db_singleton_enabled && pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}
