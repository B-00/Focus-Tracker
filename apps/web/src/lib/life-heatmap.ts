// Human-readable labels for the 4-tier heatmap. Boundaries track
// `LIFE_HEATMAP_HOUR_BOUNDARIES` in the shared package (10 / 25 / 45 h).
//
// Colors themselves live in `life-colors.ts` under roles h1..h4 and are
// published as CSS variables (--c-h1..h4) by <LifeGrid>. Cells reference
// them via var(...) so picker drags repaint without React re-renders.

export type HeatmapActiveTier = 1 | 2 | 3 | 4;

export const LIFE_HEATMAP_LABELS: Record<HeatmapActiveTier, string> = {
  1: '< 10 h',
  2: '10–25 h',
  3: '25–45 h',
  4: '45 h+',
};
