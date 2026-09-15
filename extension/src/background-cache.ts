const DATABASE = "tubitle-cache";
const STORE = "translations";
const MAX_ENTRIES = 30000;

interface CacheRow { key: string; value: string; accessedAt: number }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("accessedAt", "accessedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedTranslation(key: string): Promise<string | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as CacheRow | undefined)?.value);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheTranslation(key: string, value: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, value, accessedAt: Date.now() } satisfies CacheRow);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const count = await new Promise<number>((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(0);
  });
  if (count <= MAX_ENTRIES) return;
  const tx = db.transaction(STORE, "readwrite");
  const cursor = tx.objectStore(STORE).index("accessedAt").openCursor();
  let remaining = count - MAX_ENTRIES;
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (!item || remaining-- <= 0) return;
    item.delete();
    item.continue();
  };
}
