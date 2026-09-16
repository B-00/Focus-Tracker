// Durable per-day per-domain rollup for the popup's Stats view.
//
// WHY THIS EXISTS
// ---------------
// Before Slice 4 the popup summed durations by scanning the local
// IndexedDB outbox (`outbox.sumTodayByDomain()`). Slice 4's flusher
// now drains that outbox every 60s and deletes acked events, so the
// popup would only ever see the last ~minute of browsing.
//
// The rollup is a tiny key/value in `browser.storage.local` that:
//   * accumulates `focus_change` durations on every close-out
//   * survives outbox flushes (it's a parallel structure, not derived
//     from the outbox)
//   * survives event-page suspend/wake and Firefox restarts
//   * auto-resets on local-day rollover
//
// The rollup is NOT authoritative — the API is. The web dashboard is
// still the accurate view of history. The rollup exists purely to
// keep the popup useful without hitting the network from an API-key-
// only client. If the user clears storage or reinstalls the extension,
// the rollup starts empty; today's real numbers live in the API and
// show up on the web dashboard.

const KEY = 'dailyRollup';

/// Local-date key, YYYY-MM-DD in the user's wall clock. We deliberately
/// use local time (not UTC) so the rollup matches the user's intuitive
/// meaning of "today" — same convention the web dashboard uses.
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface StoredRollup {
  date: string; // YYYY-MM-DD local
  totals: Record<string, number>; // domain → durationMs
}

export interface DomainTotal {
  domain: string;
  durationMs: number;
}

export interface RollupSnapshot {
  /// `YYYY-MM-DD` in the user's local timezone. Popup can render this
  /// so a stale rollup (e.g. clock crossed midnight while popup was
  /// open) is at least visible.
  date: string;
  totals: DomainTotal[];
  totalMs: number;
}

/// Add `durationMs` to `domain`'s running total for today. If today's
/// date differs from the stored rollup's date, the stored rollup is
/// discarded first (yesterday's numbers don't leak into today's chart).
///
/// Concurrency: sequenced through `chain` so overlapping calls can't
/// lost-update via read-modify-write races. `browser.storage.local`
/// promises resolve on the extension's own event loop, so a simple
/// promise chain is sufficient — no cross-context locking needed.
export function addTime(domain: string, durationMs: number): Promise<void> {
  if (durationMs <= 0) return Promise.resolve();
  chain = chain.then(
    () => addTimeInner(domain, durationMs),
    () => addTimeInner(domain, durationMs),
  );
  return chain;
}

let chain: Promise<void> = Promise.resolve();

async function addTimeInner(domain: string, durationMs: number): Promise<void> {
  const today = localDateKey(new Date());
  const bag = await browser.storage.local.get(KEY);
  const stored = bag[KEY] as StoredRollup | undefined;
  const rollup: StoredRollup =
    stored && stored.date === today ? stored : { date: today, totals: {} };
  rollup.totals[domain] = (rollup.totals[domain] ?? 0) + durationMs;
  await browser.storage.local.set({ [KEY]: rollup });
}

/// Snapshot of today's rollup, sorted descending by duration. Returns
/// an empty snapshot (still stamped with today's date) if the stored
/// rollup is missing or stale.
export async function getSnapshot(): Promise<RollupSnapshot> {
  const today = localDateKey(new Date());
  const bag = await browser.storage.local.get(KEY);
  const stored = bag[KEY] as StoredRollup | undefined;
  if (!stored || stored.date !== today) {
    return { date: today, totals: [], totalMs: 0 };
  }
  const totals = Object.entries(stored.totals)
    .map(([domain, durationMs]) => ({ domain, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs);
  const totalMs = totals.reduce((sum, t) => sum + t.durationMs, 0);
  return { date: today, totals, totalMs };
}

/// For devtools / a future Options-page "reset today's stats" button.
export async function clearRollup(): Promise<void> {
  chain = chain.then(
    () => browser.storage.local.remove(KEY),
    () => browser.storage.local.remove(KEY),
  );
  await chain;
}
