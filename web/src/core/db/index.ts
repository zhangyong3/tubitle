import { envConfigs } from '@/config';

import { createDb } from './create-db';
import { getDbScope } from './request-scope';
import { isCloudflareWorker, TCP_PROVIDERS } from './runtime';

let dbInstance: any = null;

function buildDb() {
  return createDb({
    database_provider: envConfigs.database_provider,
    database_url: envConfigs.database_url || 'file:data/local.db',
    database_auth_token: envConfigs.database_auth_token || undefined,
    db_schema: envConfigs.db_schema,
    db_singleton_enabled: envConfigs.db_singleton_enabled,
    db_max_connections: envConfigs.db_max_connections,
  });
}

export function db() {
  if (dbInstance) return dbInstance;

  // Workers + TCP driver (postgres/mysql): one client per request, never
  // across requests — see request-scope.ts. Hyperdrive does the real pooling
  // at the edge. Outside a request scope, fall back to a fresh client per call.
  if (
    isCloudflareWorker &&
    TCP_PROVIDERS.includes(envConfigs.database_provider)
  ) {
    const scope = getDbScope();
    if (scope?.db) return scope.db;
    const instance = buildDb();
    if (scope) scope.db = instance;
    return instance;
  }

  // The D1 binding and local Node drivers are safe to cache.
  dbInstance = buildDb();
  return dbInstance;
}

export type { DbConfig } from './types';
export { createDb, closeDb } from './create-db';
export {
  getHyperdriveConnectionString,
  hasDatabaseConfigured,
  isCloudflareWorker,
} from './runtime';

/**
 * Rows changed by an UPDATE/DELETE, across drivers: libsql `rowsAffected`,
 * D1 `meta.changes`, postgres-js `count`, mysql2 `[{ affectedRows }]`.
 * Returns undefined for an unknown result shape.
 */
export function affectedRows(result: any): number | undefined {
  const r = Array.isArray(result) && !('count' in result) ? result[0] : result;
  const n = r?.rowsAffected ?? r?.meta?.changes ?? r?.count ?? r?.affectedRows;
  return typeof n === 'number' ? n : undefined;
}
