export interface OfflineDictionaryMetadata {
  configured: boolean;
  name: string;
  size: number;
  lastModified: number;
}

interface DictionaryRecord {
  id: "primary" | "stylesheet";
  blob: Blob;
  name: string;
  size: number;
  lastModified: number;
}

interface DictionaryResourceRecord {
  id: "resources";
  files: Array<Omit<DictionaryRecord, "id">>;
}

export interface DictionaryQuery {
  word: string;
  requestId: string;
  createdAt: number;
}

export const DICTIONARY_QUERY_KEY = "offlineDictionaryQuery";
const DATABASE_NAME = "tubetitle-offline-dictionary";
const STORE_NAME = "files";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开离线词典存储"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("离线词典存储操作失败"));
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("离线词典存储事务失败"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("离线词典存储事务已中止"));
    };
  });
}

export async function saveOfflineDictionary(file: File): Promise<OfflineDictionaryMetadata> {
  if (!file.name.toLowerCase().endsWith(".mdx")) throw new Error("请选择 .mdx 格式的词典文件");
  if (file.size === 0) throw new Error("词典文件为空");
  await withStore("readwrite", (store) => store.put({
    id: "primary",
    blob: file,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified
  } satisfies DictionaryRecord));
  return { configured: true, name: file.name, size: file.size, lastModified: file.lastModified };
}

export async function getOfflineDictionaryFile(): Promise<File | undefined> {
  const record = await withStore<DictionaryRecord | undefined>("readonly", (store) => store.get("primary"));
  if (!record) return undefined;
  return new File([record.blob], record.name, {
    type: "application/octet-stream",
    lastModified: record.lastModified
  });
}

export async function removeOfflineDictionary(): Promise<void> {
  await withStore("readwrite", (store) => store.delete("primary"));
}

export async function saveOfflineDictionaryCss(file: File): Promise<OfflineDictionaryMetadata> {
  if (!file.name.toLowerCase().endsWith(".css")) throw new Error("请选择 .css 格式的词典样式文件");
  if (file.size === 0) throw new Error("CSS 文件为空");
  await withStore("readwrite", (store) => store.put({
    id: "stylesheet",
    blob: file,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified
  } satisfies DictionaryRecord));
  return { configured: true, name: file.name, size: file.size, lastModified: file.lastModified };
}

export async function getOfflineDictionaryCss(): Promise<string> {
  const record = await withStore<DictionaryRecord | undefined>("readonly", (store) => store.get("stylesheet"));
  if (!record) return "";
  const bytes = new Uint8Array(await record.blob.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = bytes.subarray(2).slice();
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  const sampleLength = Math.min(bytes.length, 200);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) index % 2 === 0 ? evenNulls++ : oddNulls++;
  }
  if (oddNulls > sampleLength / 8) return new TextDecoder("utf-16le").decode(bytes);
  if (evenNulls > sampleLength / 8) {
    const swapped = bytes.slice();
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const replacementCount = [...utf8].filter((character) => character === "�").length;
  if (replacementCount > Math.max(2, utf8.length / 500)) {
    try { return new TextDecoder("gb18030").decode(bytes); } catch { /* use UTF-8 below */ }
  }
  return utf8.replace(/^\uFEFF/, "");
}

export async function removeOfflineDictionaryCss(): Promise<void> {
  await withStore("readwrite", (store) => store.delete("stylesheet"));
}

export async function saveOfflineDictionaryResources(files: File[]): Promise<ExtensionResourceMetadata> {
  if (files.length === 0) throw new Error("请选择至少一个 .mdd 资源文件");
  if (files.some((file) => !file.name.toLowerCase().endsWith(".mdd"))) {
    throw new Error("词典资源必须是 .mdd 文件");
  }
  if (files.some((file) => file.size === 0)) throw new Error("MDD 资源文件为空");
  await withStore("readwrite", (store) => store.put({
    id: "resources",
    files: files.map((file) => ({
      blob: file,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified
    }))
  } satisfies DictionaryResourceRecord));
  return {
    configured: true,
    files: files.map(({ name, size, lastModified }) => ({ name, size, lastModified }))
  };
}

export interface ExtensionResourceMetadata {
  configured: boolean;
  files: Array<{ name: string; size: number; lastModified: number }>;
}

export async function getOfflineDictionaryResourceFiles(): Promise<File[]> {
  const record = await withStore<DictionaryResourceRecord | undefined>("readonly", (store) => store.get("resources"));
  return record?.files.map((file) => new File([file.blob], file.name, {
    type: "application/octet-stream",
    lastModified: file.lastModified
  })) ?? [];
}

export async function removeOfflineDictionaryResources(): Promise<void> {
  await withStore("readwrite", (store) => store.delete("resources"));
}
