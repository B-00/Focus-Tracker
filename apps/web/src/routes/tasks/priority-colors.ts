import { useSyncExternalStore } from 'react';
import type { TaskPriority } from '@focus-tracker/shared';

// User-local palette for priority chips + row tints. Persisted in
// localStorage so a reload keeps the user's picks. Shared via a tiny
// module-level store + useSyncExternalStore so every TaskRow /
// PriorityBadge / picker swatch rerenders the instant a color changes.
//
// ponytail: localStorage-only means picks don't sync across devices or
// browsers. Upgrade path if ever wanted: move this map into the user's
// server-side settings and swap the storage layer here — the hook
// contract stays the same.

export const DEFAULT_PRIORITY_COLORS: Record<TaskPriority, string> = {
  extreme: '#ef4444', // red-500
  high: '#f97316', // orange-500
  mid: '#10b981', // emerald-500
  low: '#c084fc', // purple-400
};

const STORAGE_KEY = 'ft:priority-colors:v1';

type Palette = Record<TaskPriority, string>;

function load(): Palette {
  if (typeof window === 'undefined') return { ...DEFAULT_PRIORITY_COLORS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PRIORITY_COLORS };
    const parsed = JSON.parse(raw) as Partial<Palette>;
    // Merge over defaults — if a future priority is added, old blobs
    // still work; invalid priorities on disk are ignored.
    return { ...DEFAULT_PRIORITY_COLORS, ...parsed };
  } catch {
    return { ...DEFAULT_PRIORITY_COLORS };
  }
}

let state: Palette = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setPriorityColor(priority: TaskPriority, hex: string) {
  if (state[priority] === hex) return;
  state = { ...state, [priority]: hex };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled / full — fail silent, in-memory still updates.
  }
  emit();
}

export function resetPriorityColors() {
  state = { ...DEFAULT_PRIORITY_COLORS };
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

export function usePriorityColors(): Palette {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// Hex "#rrggbb" → "rgba(r, g, b, a)". Used to derive the soft row tint
/// and the chip's semi-transparent background from a single picked color
/// so a palette tweak keeps the chip and the row visually in sync.
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex; // defensive: unknown format, pass through
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Self-check: round-trip default colors through withAlpha so a regression
// (bad hex parsing, dropped channels) shows up on first import in dev.
if (import.meta.env?.DEV) {
  for (const hex of Object.values(DEFAULT_PRIORITY_COLORS)) {
    const out = withAlpha(hex, 0.1);
    if (!out.startsWith('rgba(')) {
      // eslint-disable-next-line no-console
      console.warn('[priority-colors] withAlpha failed for', hex, '→', out);
    }
  }
}
