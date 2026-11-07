// Memento Mori life-calendar wire contracts (MementoMori.md §6.1 / §7).
//
// `GET /v1/life/grid` returns one aggregated row per week-since-birthday
// that has telemetry rollup activity. Weeks with no row render as the
// "no activity" shade on the client (unified pre-tracking + measured-idle
// per Slice 2.1 — the distinct-neutral tracking distinction from spec
// §4.2 is intentionally collapsed for v1 readability; both states look
// identical and the tooltip just says "no activity").
//
// We bundle the user's `birthday`, `lifeExpectancyYears`, and the
// current week index into the same response so the client can render
// the whole grid off one round-trip.
//
// Heatmap bucket boundaries live in this file so the API, the web UI,
// and any future client (desktop/extension) read from one source.

import { z } from 'zod';

// ---------------------------------------------------------------------------
//  Heatmap buckets — MementoMori.md §4.2 (4-tier variant per user ask)
// ---------------------------------------------------------------------------

/// Hour boundaries between heatmap tiers.
///
///   tier 0 : exactly 0 min              (idle week — rendered same as pre-tracking)
///   tier 1 : > 0 min and < 10 h         (light activity)
///   tier 2 : >= 10 h and < 25 h         (regular)
///   tier 3 : >= 25 h and < 45 h         (heavy)
///   tier 4 : >= 45 h                    (very heavy / full-time)
///
/// 4 active tiers + tier 0 (treated as empty on the client). Boundaries
/// are tunable; initial values are picked for a typical always-on
/// telemetry profile. Numeric values are **hours**.
export const LIFE_HEATMAP_HOUR_BOUNDARIES = [10, 25, 45] as const;

export type LifeHeatmapTier = 0 | 1 | 2 | 3 | 4;

/// Map total telemetry minutes for a week → heatmap tier. Returns 0 for
/// "measured but idle" which the client renders identically to "no row"
/// (unified empty state).
export function lifeHeatmapTier(totalMinutes: number): LifeHeatmapTier {
  if (totalMinutes <= 0) return 0;
  const hours = totalMinutes / 60;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[0]) return 1;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[1]) return 2;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[2]) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
//  GET /v1/life/grid
// ---------------------------------------------------------------------------

/// One row per week with telemetry activity. Sparse — weeks the user
/// hasn't used any paired device during are simply absent.
export const lifeGridWeekSchema = z.object({
  weekIndex: z.number().int().nonnegative(),
  telemetryMinutes: z.number().int().nonnegative(),
});
export type LifeGridWeek = z.infer<typeof lifeGridWeekSchema>;

/// Response envelope. Grid rendering is fully driven by the presence /
/// absence of a `weeks[]` row + its `telemetryMinutes`:
///   * past + no row            → "no activity" (--c-lived)
///   * past + row, tier === 0   → "no activity" (--c-lived)
///   * past + row, tier 1..4    → heatmap color
///   * current week             → --c-this
///   * future                   → --c-rem
export const lifeGridResponseSchema = z.object({
  birthday: z.string(),                           // yyyy-mm-dd
  lifeExpectancyYears: z.number().int().positive(),
  currentWeekIndex: z.number().int(),             // may be negative if birthday is in the future
  weeks: z.array(lifeGridWeekSchema),
});
export type LifeGridResponse = z.infer<typeof lifeGridResponseSchema>;

// ---------------------------------------------------------------------------
//  Runnable self-check (ponytail: single assert-based demo per the
//  user rule). Run with `node packages/shared/dist/life.js`.
// ---------------------------------------------------------------------------

/* v8 ignore start */
function selfCheck(): void {
  const assert = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(`life self-check: ${msg}`);
  };

  // Tier boundaries — 4-tier variant.
  assert(lifeHeatmapTier(0) === 0, 'zero min → tier 0');
  assert(lifeHeatmapTier(1) === 1, '1 min → tier 1');
  assert(lifeHeatmapTier(60 * 10 - 1) === 1, '< 10 h → tier 1');
  assert(lifeHeatmapTier(60 * 10) === 2, '10 h → tier 2');
  assert(lifeHeatmapTier(60 * 25 - 1) === 2, '< 25 h → tier 2');
  assert(lifeHeatmapTier(60 * 25) === 3, '25 h → tier 3');
  assert(lifeHeatmapTier(60 * 45 - 1) === 3, '< 45 h → tier 3');
  assert(lifeHeatmapTier(60 * 45) === 4, '45 h → tier 4');
  assert(lifeHeatmapTier(60 * 168) === 4, 'full-week saturation → tier 4');
  assert(lifeHeatmapTier(-1) === 0, 'negative clamps to tier 0');

  // Round-trip the schemas — hasSessions + trackingStartWeekIndex must
  // NOT be present; reject them to lock the shape.
  const parsed = lifeGridResponseSchema.parse({
    birthday: '1990-06-15',
    lifeExpectancyYears: 80,
    currentWeekIndex: 1899,
    weeks: [
      { weekIndex: 1890, telemetryMinutes: 420 },
      { weekIndex: 1899, telemetryMinutes: 0 },
    ],
  });
  if (parsed.weeks.length !== 2) throw new Error('schema round-trip failed');
  if ('hasSessions' in parsed.weeks[0]!) {
    throw new Error('hasSessions should not survive the schema');
  }

  console.log('life: self-check OK');
}

declare const process: { argv?: string[] } | undefined;
if (
  typeof process !== 'undefined' &&
  (process.argv?.[1]?.endsWith('life.ts') || process.argv?.[1]?.endsWith('life.js'))
) {
  selfCheck();
}
/* v8 ignore stop */
