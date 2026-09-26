// Minimal IndexedDB key-value store. Data never leaves the device (docs/map-editor-design.md §2).

const DB = 'denpa2-map-editor';
const STORE = 'kv';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = f(t.objectStore(STORE));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const idbAvailable = (): boolean => typeof indexedDB !== 'undefined';

export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (!idbAvailable()) return undefined;
  try {
    return await tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx('readwrite', (s) => s.put(value, key));
  } catch {
    /* quota or private mode: caching is optional */
  }
}

export async function idbClear(): Promise<void> {
  if (!idbAvailable()) return;
  await tx('readwrite', (s) => s.clear());
}
