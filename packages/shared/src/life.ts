// Memento Mori life-calendar wire contracts (MementoMori.md §6.1 / §7).
//
// `GET /v1/life/grid` returns one aggregated row per week-since-birthday
// that has *any* data (either telemetry rollup activity or a completed
// Focus Session). Weeks with no row are rendered as the unmeasured
// "pre-tracking" shade on the client.
//
// We bundle the user's `birthday`, `lifeExpectancyYears`, and the
// current week index into the same response so the client can render
// the whole grid off one round-trip (spec: "4,000 ints + booleans +
// metadata = tiny").
//
// Heatmap bucket boundaries live in this file so the API, the web UI,
// and any future client (desktop/extension) read from one source.

import { z } from 'zod';

// ---------------------------------------------------------------------------
//  Heatmap buckets — MementoMori.md §4.2
// ---------------------------------------------------------------------------

/// Hour boundaries between heatmap tiers.
///
///   tier 0 : exactly 0 min              (idle week, devices off, vacation)
///   tier 1 : > 0 min and < 5 h
///   tier 2 : >= 5 h and < 15 h
///   tier 3 : >= 15 h and < 30 h
///   tier 4 : >= 30 h and < 50 h
///   tier 5 : >= 50 h
///
/// 6 tiers total. Boundaries are tunable; initial values come straight
/// from the spec. Numeric values are **hours**.
export const LIFE_HEATMAP_HOUR_BOUNDARIES = [5, 15, 30, 50] as const;

export type LifeHeatmapTier = 0 | 1 | 2 | 3 | 4 | 5;

/// Map total telemetry minutes for a week → heatmap tier. Returns 0 for
/// "measured but idle" (lightest non-empty shade per §4.2). The caller
/// must disambiguate "no row at all" (pre-tracking) separately — see
/// `trackingStartWeekIndex` on the grid response.
export function lifeHeatmapTier(totalMinutes: number): LifeHeatmapTier {
  if (totalMinutes <= 0) return 0;
  const hours = totalMinutes / 60;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[0]) return 1;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[1]) return 2;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[2]) return 3;
  if (hours < LIFE_HEATMAP_HOUR_BOUNDARIES[3]) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
//  GET /v1/life/grid
// ---------------------------------------------------------------------------

/// One row per week with activity data. Sparse — weeks the user hasn't
/// used any paired device during are simply absent.
export const lifeGridWeekSchema = z.object({
  weekIndex: z.number().int().nonnegative(),
  telemetryMinutes: z.number().int().nonnegative(),
  hasSessions: z.boolean(),
});
export type LifeGridWeek = z.infer<typeof lifeGridWeekSchema>;

/// Response envelope. `trackingStartWeekIndex` distinguishes "pre-
/// tracking" (unmeasured) from "measured but idle" per §4.2:
///
///   * null  → user has never paired a source; render every past cell
///             as unmeasured.
///   * N     → weeks < N are unmeasured; weeks >= N without a row in
///             `weeks` are measured-but-idle (lightest heatmap shade).
export const lifeGridResponseSchema = z.object({
  birthday: z.string(),                           // yyyy-mm-dd
  lifeExpectancyYears: z.number().int().positive(),
  currentWeekIndex: z.number().int(),             // may be negative if birthday is in the future
  trackingStartWeekIndex: z.number().int().nullable(),
  weeks: z.array(lifeGridWeekSchema),
});
export type LifeGridResponse = z.infer<typeof lifeGridResponseSchema>;

// ---------------------------------------------------------------------------
//  Runnable self-check (ponytail: single assert-based demo per the
//  user rule). Run with `node --loader ts-node/esm life.ts` or import it.
// ---------------------------------------------------------------------------

/* v8 ignore start */
function selfCheck(): void {
  const assert = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(`life self-check: ${msg}`);
  };

  // Tier boundaries — pulled straight from spec §4.2.
  assert(lifeHeatmapTier(0) === 0, 'zero min → tier 0');
  assert(lifeHeatmapTier(1) === 1, '1 min → tier 1');
  assert(lifeHeatmapTier(60 * 5 - 1) === 1, '< 5 h → tier 1');
  assert(lifeHeatmapTier(60 * 5) === 2, '5 h → tier 2');
  assert(lifeHeatmapTier(60 * 15 - 1) === 2, '< 15 h → tier 2');
  assert(lifeHeatmapTier(60 * 15) === 3, '15 h → tier 3');
  assert(lifeHeatmapTier(60 * 30) === 4, '30 h → tier 4');
  assert(lifeHeatmapTier(60 * 50) === 5, '50 h → tier 5');
  assert(lifeHeatmapTier(60 * 168) === 5, 'full-week saturation → tier 5');
  // Negative is a nonsense input but shouldn't throw — belt-and-braces
  // (schema already clamps to nonnegative on the wire).
  assert(lifeHeatmapTier(-1) === 0, 'negative clamps to tier 0');

  // Round-trip the schemas.
  const parsed = lifeGridResponseSchema.parse({
    birthday: '1990-06-15',
    lifeExpectancyYears: 80,
    currentWeekIndex: 1899,
    trackingStartWeekIndex: 1890,
    weeks: [
      { weekIndex: 1890, telemetryMinutes: 420, hasSessions: true },
      { weekIndex: 1899, telemetryMinutes: 0, hasSessions: false },
    ],
  });
  if (parsed.weeks.length !== 2) throw new Error('schema round-trip failed');
  if (parsed.trackingStartWeekIndex !== 1890) throw new Error('tracking start not preserved');

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
