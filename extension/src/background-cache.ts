const DATABASE = "tubitle-cache";
const STORE = "translations";
export const MAX_TRANSLATION_CACHE_ENTRIES = 30000;

interface CacheRow { key: string; value: string; accessedAt: number }
let connection: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("accessedAt", "accessedAt");
    };
    let blocked = false;
    request.onblocked = () => { blocked = true; connection = undefined; reject(new Error('本地翻译缓存被其他页面占用')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

export async function getCachedTranslation(key: string): Promise<string | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(key);
    let value: string | undefined;
    request.onsuccess = () => {
      const row = request.result as CacheRow | undefined;
      if (row?.key === key && typeof row.value === 'string' && row.value.trim()) {
        value = row.value;
        store.put({ ...row, accessedAt: Date.now() });
      }
    };
    // A successful request is not durable until its transaction commits.
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('本地翻译缓存读取事务中断'));
  });
}

export async function cacheTranslation(key: string, value: string): Promise<void> {
  if (!key || !value.trim()) throw new Error('不能缓存空译文');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite", { durability: 'strict' });
    const store = tx.objectStore(STORE);
    store.put({ key, value, accessedAt: Date.now() } satisfies CacheRow);
    const count = store.count();
    count.onsuccess = () => {
      let remaining = count.result - MAX_TRANSLATION_CACHE_ENTRIES;
      if (remaining <= 0) return;
      const cursor = store.index("accessedAt").openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || remaining-- <= 0) return;
        item.delete();
        item.continue();
      };
    };
    // Write and eviction are one transaction, including concurrent cache writes.
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('本地翻译缓存写入事务中断'));
  });
}
