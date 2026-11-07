// Runnable self-check for focus-session duration helpers.
//
// Run: `node packages/shared/dist/focus-sessions.check.js`
//
// Not a framework test — just assertions that fail loud if the math drifts.
// One file, no fixtures, no mocks.

import { effectiveMs, sumPauseMs, wallClockMs } from './focus-sessions.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const T0 = new Date('2026-11-06T14:00:00.000Z');
const asOf = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

// ---------------------------------------------------------------------------
//  sumPauseMs
// ---------------------------------------------------------------------------

// No pauses → 0
assert(sumPauseMs([]) === 0, 'sumPauseMs empty');

// One closed pause: 2 minutes
assert(
  sumPauseMs([
    { pausedAt: '2026-11-06T14:05:00.000Z', resumedAt: '2026-11-06T14:07:00.000Z' },
  ]) === 2 * 60_000,
  'sumPauseMs single closed',
);

// Two closed pauses add up
assert(
  sumPauseMs([
    { pausedAt: '2026-11-06T14:05:00.000Z', resumedAt: '2026-11-06T14:07:00.000Z' },
    { pausedAt: '2026-11-06T14:20:00.000Z', resumedAt: '2026-11-06T14:23:30.000Z' },
  ]) === 2 * 60_000 + 3 * 60_000 + 30_000,
  'sumPauseMs multiple',
);

// Open pause (in-flight) measured against asOf
assert(
  sumPauseMs(
    [{ pausedAt: '2026-11-06T14:05:00.000Z', resumedAt: null }],
    asOf(10 * 60_000), // 14:10
  ) === 5 * 60_000,
  'sumPauseMs open pause',
);

// Garbage / inverted times don't produce negative totals
assert(
  sumPauseMs([
    { pausedAt: '2026-11-06T14:10:00.000Z', resumedAt: '2026-11-06T14:05:00.000Z' },
  ]) === 0,
  'sumPauseMs inverted = 0',
);

// ---------------------------------------------------------------------------
//  wallClockMs
// ---------------------------------------------------------------------------

// Live session (endedAt=null): uses asOf
assert(
  wallClockMs(
    { startedAt: T0.toISOString(), endedAt: null },
    asOf(25 * 60_000),
  ) === 25 * 60_000,
  'wallClockMs live',
);

// Completed session: ignores asOf, uses endedAt
assert(
  wallClockMs(
    { startedAt: T0.toISOString(), endedAt: '2026-11-06T14:30:00.000Z' },
    asOf(999 * 60_000), // irrelevant
  ) === 30 * 60_000,
  'wallClockMs completed',
);

// ---------------------------------------------------------------------------
//  effectiveMs — the one the UI reads every second
// ---------------------------------------------------------------------------

// 30 min session, 1 pause of 5 min → 25 min effective
assert(
  effectiveMs(
    {
      startedAt: T0.toISOString(),
      endedAt: '2026-11-06T14:30:00.000Z',
      pauses: [
        { pausedAt: '2026-11-06T14:10:00.000Z', resumedAt: '2026-11-06T14:15:00.000Z' },
      ],
    } as any,
  ) === 25 * 60_000,
  'effectiveMs 30min minus 5min pause',
);

// Running session, currently paused mid-flight (open pause)
// Session started T0, now T0+10m, paused since T0+8m → effective = 8m
assert(
  effectiveMs(
    {
      startedAt: T0.toISOString(),
      endedAt: null,
      pauses: [
        { pausedAt: '2026-11-06T14:08:00.000Z', resumedAt: null },
      ],
    } as any,
    asOf(10 * 60_000),
  ) === 8 * 60_000,
  'effectiveMs live with open pause',
);

// Multiple interleaved pauses on a live session
// Started T0, now T0+1h; pauses: [10-15), [25-30), still-open [50-now)
// wall = 60m, paused = 5+5+10 = 20m, effective = 40m
assert(
  effectiveMs(
    {
      startedAt: T0.toISOString(),
      endedAt: null,
      pauses: [
        { pausedAt: '2026-11-06T14:10:00.000Z', resumedAt: '2026-11-06T14:15:00.000Z' },
        { pausedAt: '2026-11-06T14:25:00.000Z', resumedAt: '2026-11-06T14:30:00.000Z' },
        { pausedAt: '2026-11-06T14:50:00.000Z', resumedAt: null },
      ],
    } as any,
    asOf(60 * 60_000),
  ) === 40 * 60_000,
  'effectiveMs live three pauses',
);

// Floor-at-zero: pathological asOf before start
assert(
  effectiveMs(
    { startedAt: T0.toISOString(), endedAt: null, pauses: [] } as any,
    asOf(-60_000),
  ) === 0,
  'effectiveMs clamps negative wall-clock to 0',
);

console.log('focus-sessions self-check: all assertions OK');
