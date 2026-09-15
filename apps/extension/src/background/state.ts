// In-memory current-focus state for the background event page.
//
// IMPORTANT: this module's state evaporates when Firefox unloads the
// event page. Don't rely on `currentFocus` surviving across cold starts —
// it's a within-wake-cycle cache. Cross-wake durability lives in the
// IndexedDB outbox (`../storage/outbox.ts`).
//
// Slice 2 extended the record with `startedAt` so `capture.ts` can bracket
// each transition as a `focus_change` event with startedAt/endedAt.

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

let currentFocus: FocusEntry | null = null;

/**
 * Replace the current focus with `next` (or null if unfocused). Timestamp
 * `startedAt` is captured by the caller and passed in so that the moment
 * used to close out the previous focus and the moment used to open the
 * next one are exactly the same instant (no drift from two `new Date()` calls).
 */
export function setCurrentFocus(next: FocusTarget | null, startedAt: Date): void {
  currentFocus = next === null ? null : { target: next, startedAt };
}

export function getCurrentFocus(): FocusEntry | null {
  return currentFocus;
}
