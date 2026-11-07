import type { LifeHeatmapTier } from '@focus-tracker/shared';

// Hardcoded sequential color ramp for the Memento Mori heatmap tiers
// (MementoMori.md §4.2). Six shades from "measured but idle" (darkest,
// barely-above-background) to "saturated activity" (brightest, close to
// but not identical with the current-week emerald highlight).
//
// ponytail: not user-customisable in v1. The three "role" colors on the
// LifeColorPicker (lived / thisWeek / remaining) cover the semantic
// slots the user cares about; the heatmap uses its own emerald ramp so
// the sequential ordering stays visually readable regardless of theme.
// Upgrade path: extend `life-colors.ts` with a 6-tier ramp if feedback
// ever demands it, and derive from a single `lived` hue via HSL.
//
// Tailwind emerald palette mapped to each tier:
//   tier 0 → emerald-950   (dim; distinguishable from --c-rem bg)
//   tier 1 → emerald-800
//   tier 2 → emerald-700
//   tier 3 → emerald-600
//   tier 4 → emerald-500
//   tier 5 → emerald-400
//
// On the default dark theme these read as six distinct brightness
// steps against neutral-900 remaining cells.

export const LIFE_HEATMAP_RAMP: Record<LifeHeatmapTier, string> = {
  0: '#022c22', // emerald-950
  1: '#065f46', // emerald-800
  2: '#047857', // emerald-700
  3: '#059669', // emerald-600
  4: '#10b981', // emerald-500
  5: '#34d399', // emerald-400
};

/// Human-readable labels for the legend. Matches the hour boundaries in
/// `LIFE_HEATMAP_HOUR_BOUNDARIES` on the shared package.
export const LIFE_HEATMAP_LABELS: Record<LifeHeatmapTier, string> = {
  0: 'idle week',
  1: '< 5 h',
  2: '5–15 h',
  3: '15–30 h',
  4: '30–50 h',
  5: '50 h+',
};
