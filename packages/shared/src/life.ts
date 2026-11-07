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
//  GET /v1/life/weeks/{weekIndex}   (MementoMori.md §5.1 / §5.2 / §7)
//  PUT /v1/life/weeks/{weekIndex}/note
// ---------------------------------------------------------------------------

/// One entry in the "top N by durationMs" lists. `name` is the human-
/// facing label — the app name for desktop telemetry, the domain for
/// browser telemetry. Server guarantees the list is pre-sorted and
/// capped at 3 entries.
export const lifeWeekTopItemSchema = z.object({
  name: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
});
export type LifeWeekTopItem = z.infer<typeof lifeWeekTopItemSchema>;

/// WeekNote body + last-updated marker. `null` at the envelope level
/// when no note has ever been written for the week.
export const lifeWeekNoteSchema = z.object({
  body: z.string().max(2000),
  updatedAt: z.string(),     // ISO timestamp
});
export type LifeWeekNote = z.infer<typeof lifeWeekNoteSchema>;

/// Full detail payload for one week. Everything the drawer renders.
/// `isPast` collapses the past/current/future tri-state into a single
/// bool so the client can gate the note editor without re-doing week
/// math; the server owns the comparison against `currentWeekIndex`.
export const lifeWeekDetailSchema = z.object({
  weekIndex: z.number().int().nonnegative(),
  startDate: z.string(),                          // yyyy-mm-dd (inclusive)
  endDate: z.string(),                            // yyyy-mm-dd (inclusive)
  isPast: z.boolean(),
  isCurrent: z.boolean(),
  telemetryMinutes: z.number().int().nonnegative(),
  sessions: z.object({
    count: z.number().int().nonnegative(),
    totalEffectiveMs: z.number().int().nonnegative(),
  }),
  topApps: z.array(lifeWeekTopItemSchema).max(3),
  topSites: z.array(lifeWeekTopItemSchema).max(3),
  tasksCompleted: z.number().int().nonnegative(),
  note: lifeWeekNoteSchema.nullable(),
});
export type LifeWeekDetail = z.infer<typeof lifeWeekDetailSchema>;

/// PUT body. Empty string is a valid payload — the server treats it as
/// a delete of the existing note. 2000 chars matches the DB column cap
/// (schema.prisma WeekNote.body comment).
export const lifeWeekNoteUpsertSchema = z.object({
  body: z.string().max(2000),
});
export type LifeWeekNoteUpsert = z.infer<typeof lifeWeekNoteUpsertSchema>;

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

  // lifeWeekDetailSchema — round-trip a populated past week (with note)
  // and a current-week variant (no note, isCurrent=true).
  const pastWeek = lifeWeekDetailSchema.parse({
    weekIndex: 1890,
    startDate: '2026-03-02',
    endDate: '2026-03-08',
    isPast: true,
    isCurrent: false,
    telemetryMinutes: 2340,
    sessions: { count: 4, totalEffectiveMs: 7_200_000 },
    topApps: [
      { name: 'Cursor', durationMs: 5_400_000 },
      { name: 'Chrome', durationMs: 3_000_000 },
    ],
    topSites: [{ name: 'github.com', durationMs: 1_800_000 }],
    tasksCompleted: 7,
    note: { body: 'Shipped slice 2', updatedAt: '2026-03-10T10:00:00.000Z' },
  });
  assert(pastWeek.note?.body === 'Shipped slice 2', 'past week note round-trip');
  assert(pastWeek.topApps.length === 2, 'topApps round-trip');

  const currentWeek = lifeWeekDetailSchema.parse({
    weekIndex: 1899,
    startDate: '2026-09-28',
    endDate: '2026-10-04',
    isPast: false,
    isCurrent: true,
    telemetryMinutes: 180,
    sessions: { count: 0, totalEffectiveMs: 0 },
    topApps: [],
    topSites: [],
    tasksCompleted: 0,
    note: null,
  });
  assert(currentWeek.note === null, 'current week note defaults to null');

  // topApps cap of 3 is enforced
  let threw = false;
  try {
    lifeWeekDetailSchema.parse({
      ...pastWeek,
      topApps: [
        { name: 'a', durationMs: 1 },
        { name: 'b', durationMs: 1 },
        { name: 'c', durationMs: 1 },
        { name: 'd', durationMs: 1 },
      ],
    });
  } catch {
    threw = true;
  }
  assert(threw, 'topApps length > 3 is rejected');

  // Note body size cap
  const okUpsert = lifeWeekNoteUpsertSchema.parse({ body: 'x'.repeat(2000) });
  assert(okUpsert.body.length === 2000, '2000-char body OK');
  let tooLong = false;
  try {
    lifeWeekNoteUpsertSchema.parse({ body: 'x'.repeat(2001) });
  } catch {
    tooLong = true;
  }
  assert(tooLong, '2001-char body rejected');

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
