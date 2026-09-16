// IndexedDB-backed outbox for telemetry events.
//
// Purpose (Slice 2): make events durable across event-page suspensions and
// Firefox restarts. The flusher (Slice 4) will drain this store by POSTing
// batches to /v1/telemetry/batch and deleting on 202.
//
// Design:
//   * one database `focus-tracker`, one object store `outbox`
//   * primary key is the event's ULID (already time-sortable and unique)
//   * `add()` throws on duplicate key, which is what we want — a duplicate
//     means we accidentally re-appended the same ULID and that's a bug worth
//     surfacing loudly.
//
// Cross-suspension safety: the MV3 event page is torn down after inactivity
// and re-evaluated on wake, so this module's `dbPromise` cache starts fresh
// each wake. No manual invalidation needed.
//
// ponytail: no `idb` npm dep — the raw IndexedDB API is verbose but small.

import type { TelemetryEvent } from '@focus-tracker/shared';

const DB_NAME = 'focus-tracker';
const DB_VERSION = 1;
const STORE = 'outbox';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath: 'id' → the event's ULID is the primary key.
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error('IndexedDB open blocked — another connection is holding an old version'));
  });
  return dbPromise;
}

/**
 * Run `fn` inside a transaction on the outbox store and resolve to the
 * request's result. Both `req.onerror` and `tx.onerror` reject, because
 * IDB surfaces failures on whichever happens to fire first.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

/**
 * Append a fresh event to the outbox. Throws if an event with the same
 * ULID is already present (which would mean a caller bug — ULIDs are
 * unique per generation).
 */
export async function append(event: TelemetryEvent): Promise<void> {
  await transact('readwrite', (s) => s.add(event));
}

/**
 * Read every event currently in the outbox. Used by the devtools helper
 * `__ft_dumpOutbox()` in Slice 2; the flusher in Slice 4 will add a
 * paginated variant that only reads N-at-a-time to bound memory.
 */
export async function listAll(): Promise<TelemetryEvent[]> {
  return transact('readonly', (s) => s.getAll() as IDBRequest<TelemetryEvent[]>);
}

/** Count of events currently in the outbox. */
export async function count(): Promise<number> {
  return transact('readonly', (s) => s.count());
}

/**
 * Read the head of the outbox — up to `limit` events, in primary-key
 * (ULID) order, which is time-of-generation order. Used by the flusher
 * to build one batch per iteration.
 *
 * ponytail: we could `getAll(query, count)` in one shot — but the
 * `IDBKeyRange` argument is required in Firefox for the two-arg form,
 * and a cursor with `advance/continue` keeps the code trivially
 * correct while still bounding memory to `limit` events.
 */
export async function getBatch(limit: number): Promise<TelemetryEvent[]> {
  if (limit <= 0) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    const out: TelemetryEvent[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor === null || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push(cursor.value as TelemetryEvent);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

/**
 * Delete the given events from the outbox. Called after a successful
 * flush to ack the batch, and after a permanent-reject to dead-letter it.
 * All deletes run inside one transaction so a mid-flight failure either
 * removes everything or nothing.
 */
export async function removeMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

/**
 * Delete every event in the outbox. Not used in normal operation — this
 * is here for the devtools helper `__ft_clearOutbox()` so we can reset
 * local state during manual testing without opening the IDB inspector.
 */
export async function clear(): Promise<void> {
  await transact('readwrite', (s) => s.clear());
}

// The popup's per-domain "today" totals used to live here as
// `sumTodayByDomain()`, but Slice 4's flusher drains the outbox every
// 60s so a fresh outbox scan only sees the last minute of browsing.
// Today's totals now live in `../storage/rollup.ts`, which is a
// durable parallel structure that survives outbox flushes.
