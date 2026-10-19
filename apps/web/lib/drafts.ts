'use client';

/**
 * Local draft buffer for voice answers. Drafts live only in this browser (IndexedDB) so they
 * survive a reload but never reach the server until the member locks. Every call fails soft:
 * private windows or blocked storage simply mean drafts last for the page session.
 */
const DB_NAME = 'thirtydates-voice-drafts';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

const key = (exchangeId: string, promptKey: string) => `${exchangeId}:${promptKey}`;

export function saveDraft(exchangeId: string, promptKey: string, blob: Blob): Promise<unknown> {
  return run('readwrite', (s) => s.put(blob, key(exchangeId, promptKey)));
}

export async function loadDraft(exchangeId: string, promptKey: string): Promise<Blob | undefined> {
  const value = await run<Blob>('readonly', (s) => s.get(key(exchangeId, promptKey)));
  return value instanceof Blob ? value : undefined;
}

export function deleteDraft(exchangeId: string, promptKey: string): Promise<unknown> {
  return run('readwrite', (s) => s.delete(key(exchangeId, promptKey)));
}
