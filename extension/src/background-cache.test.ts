import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('survives a module/worker restart and reads the same browser database', async () => {
  let cache = await import('./background-cache');
  await cache.cacheTranslation('account:alice:model\0en\0zh\0Hello.', '你好。');
  vi.resetModules();
  cache = await import('./background-cache');
  expect(await cache.getCachedTranslation('account:alice:model\0en\0zh\0Hello.')).toBe('你好。');
  expect(await cache.getCachedTranslation('account:bob:model\0en\0zh\0Hello.')).toBeUndefined();
});

it('rejects aborted writes instead of reporting an uncommitted result as saved', async () => {
  const { cacheTranslation, getCachedTranslation } = await import('./background-cache');
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    const request = put.apply(this, args);
    this.transaction.abort();
    return request;
  });
  await expect(cacheTranslation('aborted', '尚未提交')).rejects.toThrow();
  expect(await getCachedTranslation('aborted')).toBeUndefined();
});

it('touches read entries and atomically evicts the least recently used entry at capacity', async () => {
  const cache = await import('./background-cache');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('tubitle-cache', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('translations', {keyPath:'key'}).createIndex('accessedAt', 'accessedAt'); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('translations', 'readwrite');
    const store = tx.objectStore('translations');
    for (let index = 0; index < cache.MAX_TRANSLATION_CACHE_ENTRIES; index++) store.put({key:`key-${index}`,value:`译文-${index}`,accessedAt:index});
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  expect(await cache.getCachedTranslation('key-0')).toBe('译文-0');
  await cache.cacheTranslation('new', '新增译文');
  expect(await cache.getCachedTranslation('key-0')).toBe('译文-0');
  expect(await cache.getCachedTranslation('key-1')).toBeUndefined();
  const count = await new Promise<number>(resolve => {
    const request = db.transaction('translations').objectStore('translations').count();
    request.onsuccess = () => resolve(request.result);
  });
  expect(count).toBe(cache.MAX_TRANSLATION_CACHE_ENTRIES);
  db.close();
});

it('never stores an empty or failed translation', async () => {
  const cache = await import('./background-cache');
  await expect(cache.cacheTranslation('empty', '  ')).rejects.toThrow();
  expect(await cache.getCachedTranslation('empty')).toBeUndefined();
});
