// `/v1/me/ui-prefs` — cross-device cosmetic picks. The stores
// (life-colors, life-size, priority-colors, priority-icons) keep
// localStorage as the first-paint cache and call pushUiPref on change;
// useHydrateUiPrefs (AppShell) pulls the server copy once per session.

import type { UiPrefs } from '@focus-tracker/shared';
import { api } from './api';

export async function fetchUiPrefs(): Promise<UiPrefs> {
  const { data } = await api.get<UiPrefs>('/v1/me/ui-prefs');
  return data;
}

// ponytail: per-key trailing debounce, fire-and-forget. A color drag fires
// dozens of onChange events; this sends one PATCH once it settles. A failed
// write logs and is healed by the next change (or re-pushed on next hydrate
// if the server never got the key). Upgrade path: retry queue.
const timers = new Map<keyof UiPrefs, ReturnType<typeof setTimeout>>();

export function pushUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      api.patch('/v1/me/ui-prefs', { [key]: value }).catch((err: unknown) => {
        console.warn('[ui-prefs] PATCH failed; local state kept', key, err);
      });
    }, 400),
  );
}

/// True while a local edit for `key` hasn't been sent yet — hydrate skips
/// those so a slow GET can't revert a pick made a moment ago.
export function isUiPrefPending(key: keyof UiPrefs): boolean {
  return timers.has(key);
}
