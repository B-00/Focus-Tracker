// In-memory current-focus state for the background event page.
//
// IMPORTANT: this module's state evaporates when Firefox unloads the
// event page. Don't rely on `currentFocus` surviving across cold starts —
// it's a within-wake-cycle cache. Cross-wake durability lives in the
// IndexedDB outbox (`../storage/outbox.ts`).
//
// Slice 2 extended the record with `startedAt` so `capture.ts` can bracket
// each transition as a `focus_change` event with startedAt/endedAt.
//
// We ALSO write-through to `browser.storage.local` on every setCurrentFocus
// so the popup can read the "what am I looking at right now" state and
// interpolate live time into today's totals (Extension.md §7 — StatsView
// live interpolation). The write is fire-and-forget: storage.local is
// promise-based, but a lost write only means the popup misses one live
// tick, which is fine — the number rolls up correctly on the next
// transition when the focus_change close-out fires.

const KEY_CURRENT_FOCUS = 'currentFocus';

export interface FocusTarget {
  /// Lowercased hostname with leading "www." stripped. Stable identity
  /// across "www.example.com" and "example.com" so the server's
  /// per-target rollup doesn't fragment.
  domain: string;
  /// Tab title at the moment of transition. May be empty during
  /// "loading" → "complete" briefly; the capture module fires again on
  /// `status === "complete"` to pick up the resolved title.
  tabTitle: string | null;
}

export interface FocusEntry {
  target: FocusTarget;
  /// Wall-clock moment we transitioned INTO this target. Used as the
  /// `startedAt` of the focus_change event we'll emit when we transition
  /// out again.
  startedAt: Date;
}

/// Wire shape for the persisted current-focus. `startedAt` becomes an
/// ISO string so it round-trips cleanly through storage.local's
/// structured-clone serialization.
interface StoredFocus {
  domain: string;
  tabTitle: string | null;
  startedAt: string;
}

let currentFocus: FocusEntry | null = null;

/**
 * Replace the current focus with `next` (or null if unfocused). Timestamp
 * `startedAt` is captured by the caller and passed in so that the moment
 * used to close out the previous focus and the moment used to open the
 * next one are exactly the same instant (no drift from two `new Date()` calls).
 */
export function setCurrentFocus(next: FocusTarget | null, startedAt: Date): void {
  currentFocus = next === null ? null : { target: next, startedAt };
  void persistCurrentFocus(currentFocus).catch((err: unknown) => {
    console.warn('[focus-tracker] persist currentFocus failed', err);
  });
}

export function getCurrentFocus(): FocusEntry | null {
  return currentFocus;
}

async function persistCurrentFocus(entry: FocusEntry | null): Promise<void> {
  if (entry === null) {
    await browser.storage.local.remove(KEY_CURRENT_FOCUS);
    return;
  }
  const stored: StoredFocus = {
    domain: entry.target.domain,
    tabTitle: entry.target.tabTitle,
    startedAt: entry.startedAt.toISOString(),
  };
  await browser.storage.local.set({ [KEY_CURRENT_FOCUS]: stored });
}

/// Read the persisted current focus. Used by the popup (running in a
/// separate context from the background) to interpolate live time into
/// today's totals. Returns null if unfocused or if the stored value
/// looks malformed.
export async function readPersistedCurrentFocus(): Promise<FocusEntry | null> {
  const bag = await browser.storage.local.get(KEY_CURRENT_FOCUS);
  const raw = bag[KEY_CURRENT_FOCUS] as Partial<StoredFocus> | undefined;
  if (!raw || typeof raw.domain !== 'string' || typeof raw.startedAt !== 'string') {
    return null;
  }
  const startedAt = new Date(raw.startedAt);
  if (Number.isNaN(startedAt.getTime())) return null;
  return {
    target: {
      domain: raw.domain,
      tabTitle: typeof raw.tabTitle === 'string' ? raw.tabTitle : null,
    },
    startedAt,
  };
}
