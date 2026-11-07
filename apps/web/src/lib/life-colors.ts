import { useSyncExternalStore } from 'react';

// User-local palette for the Memento Mori life grid. Three roles:
//   - lived: weeks already past
//   - thisWeek: the single highlighted current-week cell
//   - remaining: future weeks still to come
//
// Same shape + persistence as priority-colors.ts (localStorage + tiny
// module-level store + useSyncExternalStore). Everything that paints
// a life cell (main /life grid + dashboard strip widget) subscribes.
//
// ponytail: localStorage-only — picks don't sync across devices. Upgrade
// path: move into UserDashboardPrefs or a dedicated LifePrefs table; the
// hook contract here stays the same.

export type LifeColorRole = 'lived' | 'thisWeek' | 'remaining';

export const DEFAULT_LIFE_COLORS: Record<LifeColorRole, string> = {
  lived: '#404040',     // neutral-700
  thisWeek: '#34d399',  // emerald-400
  remaining: '#171717', // neutral-900
};

const STORAGE_KEY = 'ft:life-colors:v1';

type Palette = Record<LifeColorRole, string>;

function load(): Palette {
  if (typeof window === 'undefined') return { ...DEFAULT_LIFE_COLORS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LIFE_COLORS };
    const parsed = JSON.parse(raw) as Partial<Palette>;
    // Merge over defaults — if a future role is added, old blobs still
    // work; invalid roles on disk are ignored.
    return { ...DEFAULT_LIFE_COLORS, ...parsed };
  } catch {
    return { ...DEFAULT_LIFE_COLORS };
  }
}

let state: Palette = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setLifeColor(role: LifeColorRole, hex: string) {
  if (state[role] === hex) return;
  state = { ...state, [role]: hex };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled / full — fail silent, in-memory still updates.
  }
  emit();
}

export function resetLifeColors() {
  state = { ...DEFAULT_LIFE_COLORS };
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ditto
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Palette {
  return state;
}

export function useLifeColors(): Palette {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
