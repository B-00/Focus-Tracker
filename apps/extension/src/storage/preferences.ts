// User-controllable preferences persisted in `browser.storage.local`.
//
// Extension.md §10 calls out a `pause` toggle: while paused the extension
// captures nothing and flushes nothing, but the outbox and rollup are
// preserved. Slice 4's flusher and the capture path both consult this
// value on every tick / transition.
//
// Adding more prefs later (full-URL opt-in, per-domain excludes, etc.)
// should extend the `Preferences` interface here rather than sprinkling
// new keys across `device.ts` / `rollup.ts` — one place = one story.
//
// ponytail: no getter cache. Reads are cheap (single storage.local.get);
// caching would risk stale reads across event-page wake cycles and
// buy us nothing measurable.

const KEY_PAUSED = 'preferences.paused';

export interface Preferences {
  paused: boolean;
}

/** Reads current prefs, filling in defaults for any missing keys. */
export async function getPreferences(): Promise<Preferences> {
  const bag = await browser.storage.local.get(KEY_PAUSED);
  return {
    paused: bag[KEY_PAUSED] === true,
  };
}

/** Convenience — the common case: "should the capture / flusher run right now?" */
export async function isPaused(): Promise<boolean> {
  const bag = await browser.storage.local.get(KEY_PAUSED);
  return bag[KEY_PAUSED] === true;
}

export async function setPaused(paused: boolean): Promise<void> {
  await browser.storage.local.set({ [KEY_PAUSED]: paused });
}

/**
 * Fires `handler(prefs)` whenever any preference key changes. Returns
 * an unsubscribe function so React `useEffect` cleanups can drop the
 * listener when the popup closes.
 *
 * `browser.storage.onChanged` fires cross-context (background <-> popup)
 * so the popup's toggle click immediately propagates to the background
 * without any messaging plumbing.
 */
export function subscribePreferences(
  handler: (next: Preferences) => void,
): () => void {
  const listener = (
    changes: Record<string, browser.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    if (!(KEY_PAUSED in changes)) return;
    void getPreferences().then(handler);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
