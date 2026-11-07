import { useSyncExternalStore } from 'react';

// Grid-size preference for the Memento Mori view. Four tiers (S/M/L/XL).
// Published as CSS variables by <LifeGrid> so changing the size is a
// single CSS-var write per var; no React re-renders of the thousands
// of memo'd cells. Same pattern as life-colors + priority-colors.

export type LifeSize = 's' | 'm' | 'l' | 'xl';

export interface LifeSizePreset {
  cell: number;      // cell edge, px
  gap: number;       // inter-cell gap, px
  blockGap: number;  // decade row-gap + mid-year col-gap, px
  axisFont: string;  // tick label font-size
  axisW: number;     // year-axis column width, px
  axisH: number;     // week-axis row height, px
  /// Cell-hover tooltip dimensions. Scales with cell size so XL grids
  /// don't look weird with a tiny S-sized tooltip floating over a
  /// 20-pixel cell. `h` is a conservative estimate used only for the
  /// viewport-edge clamp logic in CellTooltip.
  tooltip: {
    w: number;
    h: number;
    pad: string;
    headerFont: string;
    valueFont: string;
    detailFont: string;
  };
}

export const LIFE_SIZE_PRESETS: Record<LifeSize, LifeSizePreset> = {
  s:  {
    cell: 8, gap: 2, blockGap: 8, axisFont: '0.55rem', axisW: 26, axisH: 14,
    tooltip: { w: 176, h: 92,  pad: '0.6rem',   headerFont: '0.6rem',  valueFont: '0.85rem',  detailFont: '0.65rem' },
  },
  m:  {
    cell: 10, gap: 2, blockGap: 10, axisFont: '0.6rem', axisW: 32, axisH: 18,
    tooltip: { w: 192, h: 104, pad: '0.75rem',  headerFont: '0.65rem', valueFont: '1rem',     detailFont: '0.7rem'  },
  },
  l:  {
    cell: 14, gap: 3, blockGap: 14, axisFont: '0.75rem', axisW: 40, axisH: 22,
    tooltip: { w: 224, h: 120, pad: '0.9rem',   headerFont: '0.7rem',  valueFont: '1.125rem', detailFont: '0.75rem' },
  },
  xl: {
    cell: 20, gap: 4, blockGap: 20, axisFont: '0.9rem', axisW: 52, axisH: 28,
    tooltip: { w: 272, h: 148, pad: '1.1rem',   headerFont: '0.8rem',  valueFont: '1.375rem', detailFont: '0.85rem' },
  },
};

export const DEFAULT_LIFE_SIZE: LifeSize = 'm';
const ORDER: readonly LifeSize[] = ['s', 'm', 'l', 'xl'];
const STORAGE_KEY = 'ft:life-size:v1';

function load(): LifeSize {
  if (typeof window === 'undefined') return DEFAULT_LIFE_SIZE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && ORDER.includes(raw as LifeSize)) return raw as LifeSize;
  } catch {
    // Storage disabled — fall through to default.
  }
  return DEFAULT_LIFE_SIZE;
}

let state: LifeSize = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setLifeSize(size: LifeSize) {
  if (state === size) return;
  state = size;
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Storage disabled — in-memory still updates for this session.
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): LifeSize {
  return state;
}

export function useLifeSize(): LifeSize {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
