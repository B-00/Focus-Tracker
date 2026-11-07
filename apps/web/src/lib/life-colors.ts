import { useSyncExternalStore } from 'react';

// User-local palette for the Memento Mori life grid. Seven roles:
//   - lived: weeks already past WITHOUT telemetry data (incl. idle weeks)
//   - thisWeek: the single highlighted current-week cell
//   - remaining: future weeks still to come
//   - h1..h4: 4 ascending heatmap tiers for past weeks WITH telemetry
//
// Same shape + persistence as priority-colors.ts (localStorage + tiny
// module-level store + useSyncExternalStore). Everything that paints
// a life cell (main /life grid + dashboard strip widget) subscribes.
//
// Both color pickers in /life (Grid colors + Heatmap colors) read + write
// from this single store — merge-over-defaults keeps older localStorage
// blobs (pre-heatmap-picker shape) forward-compatible.
//
// ponytail: localStorage-only — picks don't sync across devices. Upgrade
// path: move into UserDashboardPrefs or a dedicated LifePrefs table; the
// hook contract here stays the same.

export type LifeColorRole =
  | 'lived'
  | 'thisWeek'
  | 'remaining'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4';

export const DEFAULT_LIFE_COLORS: Record<LifeColorRole, string> = {
  lived: '#404040',     // neutral-700
  thisWeek: '#34d399',  // emerald-400
  remaining: '#171717', // neutral-900
  // Heatmap ramp, ascending brightness. Defaults picked distinct from
  // the current-week highlight so the brightest tier doesn't look
  // identical to --c-this on a crowded row.
  h1: '#064e3b',        // emerald-900 (faint)
  h2: '#047857',        // emerald-700
  h3: '#10b981',        // emerald-500
  h4: '#6ee7b7',        // emerald-300 (brightest)
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
