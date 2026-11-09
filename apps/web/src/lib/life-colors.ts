import { useSyncExternalStore } from 'react';
import { isUiPrefPending, pushUiPref } from './ui-prefs-api';

// User-local palette for the Memento Mori life grid. Ten roles:
//   - lived: weeks already past WITHOUT telemetry data (incl. idle weeks)
//   - thisWeek: the single highlighted current-week cell
//   - remaining: future weeks still to come
//   - h1..h4: 4 ascending heatmap tiers for past weeks WITH telemetry
//   - m1..m3: milestone-count dots (1 / 2 / 3+ milestones on a week)
//
// Same shape + persistence as priority-colors.ts (localStorage + tiny
// module-level store + useSyncExternalStore). Everything that paints
// a life cell (main /life grid + dashboard strip widget) subscribes.
//
// Both color pickers in /life (Grid colors + Heatmap colors) read + write
// from this single store — merge-over-defaults keeps older localStorage
// blobs (pre-heatmap-picker shape) forward-compatible.
//
// Synced across devices via `User.uiPrefs.lifeColors` (ui-prefs-api.ts);
// localStorage stays as the first-paint cache.

export type LifeColorRole =
  | 'lived'
  | 'thisWeek'
  | 'remaining'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'm1'
  | 'm2'
  | 'm3';

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
  // Milestone-count dots. Distinct from heatmap greens so a busy week
  // still reads as "something marked" rather than "lots of activity".
  m1: '#3b82f6',        // blue-500
  m2: '#ec4899',        // pink-500
  m3: '#f59e0b',        // amber-500
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

function commit(next: Palette, push: boolean) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled / full — fail silent, in-memory still updates.
  }
  if (push) pushUiPref('lifeColors', state);
  emit();
}

export function setLifeColor(role: LifeColorRole, hex: string) {
  if (state[role] === hex) return;
  commit({ ...state, [role]: hex }, true);
}

export function resetLifeColors() {
  commit({ ...DEFAULT_LIFE_COLORS }, true);
}

/// Apply the server copy (no echo PATCH). Missing on the server = first
/// sync from this browser, so upload the local picks instead.
export function hydrateLifeColors(remote: Partial<Palette> | undefined) {
  if (isUiPrefPending('lifeColors')) return;
  if (!remote) return pushUiPref('lifeColors', state);
  commit({ ...DEFAULT_LIFE_COLORS, ...remote }, false);
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
