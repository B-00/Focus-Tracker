// Week math for the Memento Mori life calendar (MementoMori.md §3.1).
//
// Deliberately dep-free — date-fns is listed in the spec but the math is
// a one-liner. Browser's native Date + ms arithmetic is enough.
//
// Week index semantics (spec-pinned):
//   * week 0  = the 7-day window starting on the user's birthday
//   * week N  = floor((today - birthday) / 7 days)
//   * totalWeeks = lifeExpectancyYears * 52  (poster-style approximation,
//     not an ISO-week count; crossing-year drift is tolerated per §10)
//
// All inputs are treated as UTC midnight to keep DST / tz drift out of
// the index math. The caller's local-tz interpretation of "today" is
// their responsibility — pass a Date that resolves to the local calendar
// date you want bucketed.

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

export interface LifeStats {
  birthday: Date;
  currentWeekIndex: number; // may be negative for "not born yet" (defensive)
  totalWeeks: number;       // lifeExpectancyYears * 52
  percentLived: number;     // clamped to [0, 100]
}

/// Parse a 'yyyy-mm-dd' string as a UTC-midnight Date. Returns null for
/// anything unparseable so the caller can gate rendering cleanly.
export function parseBirthday(ymd: string | null | undefined): Date | null {
  if (!ymd) return null;
  // Accept 'yyyy-mm-dd' only; reject anything else to avoid locale
  // interpretation surprises.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]!);
  const mo = Number(m[2]!) - 1;
  const d = Number(m[3]!);
  const t = Date.UTC(y, mo, d);
  if (!Number.isFinite(t)) return null;
  // Round-trip sanity: reject 'yyyy-13-40' style inputs that Date silently normalises.
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo || back.getUTCDate() !== d) {
    return null;
  }
  return back;
}

/// Current calendar date as a UTC-midnight Date. Pulls from `Date.now()`
/// through the local calendar day, so a user's "today" matches what they'd
/// see on a wall calendar.
export function todayUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/// Core: resolve the life stats from a parsed birthday + a life expectancy.
export function computeLifeStats(
  birthday: Date,
  lifeExpectancyYears: number,
  today: Date = todayUtcMidnight(),
): LifeStats {
  const diffMs = today.getTime() - birthday.getTime();
  const currentWeekIndex = Math.floor(diffMs / MS_PER_WEEK);
  const totalWeeks = Math.max(0, Math.floor(lifeExpectancyYears) * 52);
  const pct = totalWeeks > 0 ? (currentWeekIndex / totalWeeks) * 100 : 0;
  const percentLived = Math.max(0, Math.min(100, pct));
  return { birthday, currentWeekIndex, totalWeeks, percentLived };
}

/// Date range [startUtcMidnight, endUtcMidnight) covering week `weekIndex`.
/// Useful for the per-week drawer and tooltips.
export function weekRange(
  birthday: Date,
  weekIndex: number,
): { start: Date; end: Date } {
  const start = new Date(birthday.getTime() + weekIndex * MS_PER_WEEK);
  const end = new Date(start.getTime() + MS_PER_WEEK);
  return { start, end };
}

// ---------------------------------------------------------------------------
//  Runnable self-check (ponytail: single assert-based demo). Executed when
//  this module is imported as a script (`node --loader ... life-math.ts`),
//  no-op in browser / production bundle.
// ---------------------------------------------------------------------------

/* v8 ignore start */
function selfCheck(): void {
  const assert = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(`life-math self-check: ${msg}`);
  };

  // parseBirthday
  assert(parseBirthday(null) === null, 'null input → null');
  assert(parseBirthday('') === null, 'empty string → null');
  assert(parseBirthday('1990-02-30') === null, 'Feb 30 is not a real date');
  assert(parseBirthday('1990/06/15') === null, 'wrong separator rejected');
  const bday = parseBirthday('1990-06-15');
  assert(bday !== null, '1990-06-15 parses');
  assert(bday!.getUTCFullYear() === 1990, 'UTC year preserved');
  assert(bday!.getUTCMonth() === 5, 'UTC month preserved (zero-indexed)');

  // computeLifeStats: exactly one week after birthday → index 1
  const oneWeek = new Date(Date.UTC(1990, 5, 22));
  const s1 = computeLifeStats(bday!, 80, oneWeek);
  assert(s1.currentWeekIndex === 1, `1-week-after should be index 1, got ${s1.currentWeekIndex}`);
  assert(s1.totalWeeks === 80 * 52, `totalWeeks should be 4160, got ${s1.totalWeeks}`);

  // Birthday itself → index 0
  const s0 = computeLifeStats(bday!, 80, bday!);
  assert(s0.currentWeekIndex === 0, `on-birthday should be index 0, got ${s0.currentWeekIndex}`);

  // 6 days after birthday still in week 0
  const almostOne = new Date(Date.UTC(1990, 5, 21));
  const sAlmost = computeLifeStats(bday!, 80, almostOne);
  assert(sAlmost.currentWeekIndex === 0, `day 6 should still be week 0, got ${sAlmost.currentWeekIndex}`);

  // percentLived bound
  const future = new Date(Date.UTC(5000, 0, 1));
  const sMax = computeLifeStats(bday!, 80, future);
  assert(sMax.percentLived === 100, `far future clamps to 100%, got ${sMax.percentLived}`);
  const past = new Date(Date.UTC(1950, 0, 1));
  const sMin = computeLifeStats(bday!, 80, past);
  assert(sMin.percentLived === 0, `pre-birth clamps to 0%, got ${sMin.percentLived}`);

  // weekRange: start matches the birthday offset
  const { start, end } = weekRange(bday!, 2);
  assert(start.getTime() === bday!.getTime() + 2 * MS_PER_WEEK, 'week 2 starts at bday + 14 days');
  assert(end.getTime() - start.getTime() === MS_PER_WEEK, 'week range span is exactly 7 days');

   
  console.log('life-math: self-check OK');
}

// Standard main-module idiom for ESM; harmless no-op under a bundler.
declare const process: { argv?: string[] } | undefined;
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('life-math.ts')) {
  selfCheck();
}
/* v8 ignore stop */
