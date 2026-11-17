import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request db cache for Cloudflare Workers. workerd forbids reusing a TCP
// socket across requests ("Cannot perform I/O on behalf of a different
// request"), so the postgres/mysql client can't be a module singleton there —
// but within one request it should be shared, otherwise every db() call opens
// its own Hyperdrive connection (and Workers cap a request at 6 concurrent
// outbound connections).
//
// Deliberately imports no driver, so src/server.ts can wrap requests in a
// scope without pulling database code into the entry.
type DbScope = { db?: any };

const storage = new AsyncLocalStorage<DbScope>();

export function runWithDbScope<T>(fn: () => T): T {
  return storage.run({}, fn);
}

export function getDbScope(): DbScope | undefined {
  return storage.getStore();
}
