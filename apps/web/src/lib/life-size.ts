import { useSyncExternalStore } from 'react';
import { isUiPrefPending, pushUiPref } from './ui-prefs-api';

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

// ---------------------------------------------------------------------------
//  Viewport fit (phones / tablets)
// ---------------------------------------------------------------------------
//
// The grid is always 52 columns, so even S (~550px) overflows a phone.
// Below FIT_BELOW_PX the saved preset is a *max*: if it doesn't fit the
// available width, cells + gaps shrink (from the compact S axis) until
// it does. Desktop keeps the exact preset; the saved pick is untouched,
// so one synced preference gives each device its own effective size.
//
// ponytail: fit is viewport-based, not measured. Assumes the single-
// column < xl layout of /life (grid spans <main>'s content box). At ≥ xl
// the rails sit beside the grid and the preset is used as-is.

export const FIT_BELOW_PX = 1280; // Tailwind xl — matches Life.tsx layout switch
const MAIN_MAX_W = 1400; // <main className="max-w-[1400px]">
const MAIN_PAD_X = 32; // px-4 on both sides

/// Rendered grid width: year axis + axis gap + 52 cells + 50 in-half gaps
/// + the mid-year block gap.
export function lifeGridWidth(p: LifeSizePreset): number {
  return p.axisW + 52 * p.cell + 51 * p.gap + p.blockGap;
}

/// Width available to the grid for a given viewport width (clientWidth).
export function lifeGridAvailable(viewportW: number): number {
  return Math.min(viewportW, MAIN_MAX_W) - MAIN_PAD_X;
}

/// True when `p` renders unscaled at this viewport width.
export function lifePresetFits(p: LifeSizePreset, viewportW: number): boolean {
  return viewportW >= FIT_BELOW_PX || lifeGridWidth(p) <= lifeGridAvailable(viewportW);
}

/// The preset actually rendered at this viewport width.
export function fitLifePreset(p: LifeSizePreset, viewportW: number): LifeSizePreset {
  if (lifePresetFits(p, viewportW)) return p;
  const s = LIFE_SIZE_PRESETS.s;
  const avail = lifeGridAvailable(viewportW);
  // Whole-pixel gaps keep the lattice crisp; only the cell goes fractional.
  const gap = 1;
  const blockGap = Math.max(3, Math.round((s.blockGap * avail) / lifeGridWidth(s)));
  const cell = Math.floor(((avail - s.axisW - 51 * gap - blockGap) / 52) * 100) / 100;
  return { ...s, cell: Math.max(2, cell), gap, blockGap };
}

function subscribeViewport(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

/// Viewport width excluding the scrollbar (clientWidth), re-read on resize.
export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribeViewport,
    () => document.documentElement.clientWidth,
    () => FIT_BELOW_PX,
  );
}

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

function commit(size: LifeSize, push: boolean) {
  if (state === size) return;
  state = size;
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Storage disabled — in-memory still updates for this session.
  }
  if (push) pushUiPref('lifeSize', size);
  emit();
}

export function setLifeSize(size: LifeSize) {
  commit(size, true);
}

/// Apply the server copy (synced via `User.uiPrefs.lifeSize`). Missing on
/// the server = first sync from this browser, so upload the local pick.
export function hydrateLifeSize(remote: LifeSize | undefined) {
  if (isUiPrefPending('lifeSize')) return;
  if (!remote) return pushUiPref('lifeSize', state);
  commit(remote, false);
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

// Self-check: fitted grid never overflows common phone/tablet widths, and
// presets that already fit (or desktop) pass through unchanged.
if (import.meta.env?.DEV) {
  for (const vw of [320, 360, 390, 430, 768, 820, 1024, 1279]) {
    for (const id of ORDER) {
      const fitted = fitLifePreset(LIFE_SIZE_PRESETS[id], vw);
      if (lifeGridWidth(fitted) > lifeGridAvailable(vw)) {
        // eslint-disable-next-line no-console
        console.warn('[life-size] fit overflows', { vw, id, w: lifeGridWidth(fitted) });
      }
    }
  }
  if (fitLifePreset(LIFE_SIZE_PRESETS.xl, 1440) !== LIFE_SIZE_PRESETS.xl
    || fitLifePreset(LIFE_SIZE_PRESETS.s, 768) !== LIFE_SIZE_PRESETS.s) {
    // eslint-disable-next-line no-console
    console.warn('[life-size] fitting preset was rescaled');
  }
}
