// Timezone helpers used by ActivityService to align minute-rollup rows to
// the user's local hour / day boundaries before bucketing.
//
// We deliberately avoid date-fns / date-fns-tz here so the API doesn't grow
// a new dependency (Prisma's postinstall hook makes `pnpm install` painful
// while the dev server is running on Windows). Everything below is built
// on `Intl.DateTimeFormat`, which ships in Node 18+.
//
// Owner: Activity.md §5.3 (time zones).

import type { ActivityBucketGrain } from '@focus-tracker/shared';

interface WallClock {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number; // 0..23
  minute: number;
  second: number;
}

/// Decomposes a UTC `instant` into its wall-clock representation in the
/// target IANA timezone. Uses `en-CA` + `hourCycle: 'h23'` so the output
/// is always 24-hour and zero-padded.
export function wallClockInTz(instant: Date, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const get = (t: string): string => {
    const part = parts.find((p) => p.type === t);
    if (!part) throw new Error(`Intl.DateTimeFormat omitted part '${t}' for tz='${tz}'`);
    return part.value;
  };

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
  };
}

/// Inverse of `wallClockInTz`: given a wall-clock (y/m/d/h/min/s) in the
/// target timezone, returns the UTC instant that, when re-formatted in the
/// same tz, would show those components.
///
/// Algorithm: start with a "naive" Date.UTC interpretation, measure how
/// far it lands from the intended wall-clock in the tz, and correct.
/// One pass is enough for any IANA zone since DST offsets are at most
/// ±90 minutes — the corrected candidate always lands on the intended
/// wall-clock except at the very-rare spring-forward gap (where the input
/// time doesn't exist; we return the next valid instant, which matches
/// what date-fns-tz does).
export function zonedTimeToUtc(
  year: number,
  month: number, // 1..12
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const observed = wallClockInTz(new Date(naiveUtcMs), tz);
  const observedAsUtcMs = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second,
  );
  // `observed - intended` is the tz offset (signed, in ms). Subtract it
  // from the naive interpretation to land on the right UTC instant.
  const offsetMs = observedAsUtcMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs);
}

/// Rounds an `instant` down to the start of the bucket (hour or day) that
/// contains it in the target timezone, then returns that boundary as a
/// UTC instant. For day-grain, the boundary is local midnight; for
/// hour-grain it's local HH:00:00.
export function startOfBucketInTz(
  instant: Date,
  tz: string,
  grain: ActivityBucketGrain,
): Date {
  const wc = wallClockInTz(instant, tz);
  if (grain === 'day') {
    return zonedTimeToUtc(wc.year, wc.month, wc.day, 0, 0, 0, tz);
  }
  return zonedTimeToUtc(wc.year, wc.month, wc.day, wc.hour, 0, 0, tz);
}

/// Advances `boundary` (already aligned to a `grain` boundary in `tz`) by
/// `n` buckets while preserving the local wall-clock semantics. Critical
/// for DST: on a spring-forward day, advancing one hour from 01:00 local
/// time should land on 03:00 local, not 02:00. JavaScript's UTC-based
/// `Date` arithmetic doesn't know that; we have to go through the
/// wall-clock representation.
export function addBucketsInTz(
  boundary: Date,
  n: number,
  tz: string,
  grain: ActivityBucketGrain,
): Date {
  const wc = wallClockInTz(boundary, tz);
  if (grain === 'day') {
    return zonedTimeToUtc(wc.year, wc.month, wc.day + n, 0, 0, 0, tz);
  }
  return zonedTimeToUtc(wc.year, wc.month, wc.day, wc.hour + n, 0, 0, tz);
}
