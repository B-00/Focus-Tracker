// In-memory current-focus state for the background event page.
//
// IMPORTANT: this module's state evaporates when Firefox unloads the
// event page. Don't rely on `currentFocus` surviving across cold starts —
// it's a within-wake-cycle cache. Cross-wake durability lives in the
// IndexedDB outbox (slice 2).
//
// Slice 1 uses this just to deduplicate "same tab, redundant event"
// noise. Slice 2 will extend the record with `startedAt` so we can ship
// `focus_change` events with `endedAt = transitionTime`.

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

let currentFocus: FocusTarget | null = null;

/// Sets the new current focus and returns the previous value. The
/// caller is responsible for deciding whether the transition is
/// meaningful (capture.ts compares with `sameTarget`).
export function setCurrentFocus(next: FocusTarget | null): FocusTarget | null {
  const previous = currentFocus;
  currentFocus = next;
  return previous;
}

export function getCurrentFocus(): FocusTarget | null {
  return currentFocus;
}
