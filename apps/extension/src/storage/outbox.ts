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
 * Delete every event in the outbox. Not used in normal operation — this
 * is here for the devtools helper `__ft_clearOutbox()` so we can reset
 * local state during manual testing without opening the IDB inspector.
 */
export async function clear(): Promise<void> {
  await transact('readwrite', (s) => s.clear());
}
