import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../lib/me-api';
import { computeLifeStats, parseBirthday } from '../lib/life-math';
import { useLifeColors } from '../lib/life-colors';
import { LifeColorPicker } from './life/LifeColorPicker';

// /life — Memento Mori life calendar (MementoMori.md §3.1).
//
// Slice 1.5: poster-style grid. Columns = years (left-to-right, 1 to
// lifeExpectancyYears), rows = weeks within the year (top-to-bottom,
// 1..52). Decades are grouped: a visible gap lands every 10 columns.
// Axis labels on top (years) and left (weeks). Colors come from the
// shared life-colors store so the picker in the header repaints every
// cell instantly.
//
// Not yet (later slices): telemetry shading, session overlay, click-a-week
// drawer, milestones.
//
// ponytail: static DOM grid, one div per cell. At 110 years that's 5720
// divs — well under what React handles cheaply. We revisit only if it
// feels sluggish on the slowest supported device.

const CELL_PX = 10;
const CELL_GAP_PX = 2;
const DECADE_GAP_PX = 10;
const WEEK_AXIS_WIDTH_PX = 32;
const YEAR_AXIS_HEIGHT_PX = 20;

// Visible tick labels every 5 weeks (1, 5, 10, ..., 50). Week 52 is
// implied by the bottom edge so we don't crowd it in.
const WEEK_TICK_EVERY = 5;

export function LifePage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: meQueryKeys.profile(),
    queryFn: fetchMeProfile,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-neutral-500">Loading your life calendar…</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          Failed to load profile: {error instanceof Error ? error.message : 'unknown error'}
        </div>
      </main>
    );
  }

  const birthday = parseBirthday(data?.birthday);
  if (!birthday || !data) return <BirthdayOnboarding />;

  return <LifeGrid birthday={birthday} lifeExpectancyYears={data.lifeExpectancyYears} />;
}

// ---------------------------------------------------------------------------
//  Onboarding — shown when birthday is missing. MementoMori.md §3.2 / §9.
// ---------------------------------------------------------------------------

function BirthdayOnboarding() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Memento Mori</h1>
      <p className="mt-3 text-sm text-neutral-400">
        One pixel per week of your life. Set your birthday and expected
        lifespan to see the grid.
      </p>
      <Link
        to="/settings"
        hash="profile"
        className="mt-8 inline-block rounded-md border border-emerald-500/40 bg-emerald-500/10 px-5 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20"
      >
        Set your birthday →
      </Link>
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Grid — skeleton only. Past/current/future distinguished via color store.
// ---------------------------------------------------------------------------

interface GridProps {
  birthday: Date;
  lifeExpectancyYears: number;
}

function LifeGrid({ birthday, lifeExpectancyYears }: GridProps) {
  const stats = useMemo(
    () => computeLifeStats(birthday, lifeExpectancyYears),
    [birthday, lifeExpectancyYears],
  );
  const colors = useLifeColors();

  const totalWeeks = stats.totalWeeks;
  // Clamp currentWeekIndex into [0, totalWeeks) so a future birthday or an
  // already-exceeded lifespan still renders a sensible "current" cell.
  const current = Math.max(0, Math.min(totalWeeks - 1, stats.currentWeekIndex));

  // Chunk the years into decade blocks. Last decade may be short if
  // lifeExpectancyYears isn't a multiple of 10 (e.g. 85 → 8 full + 1
  // half-decade).
  const decades = useMemo(() => {
    const out: { startYear: number; yearsInDecade: number }[] = [];
    for (let startYear = 0; startYear < lifeExpectancyYears; startYear += 10) {
      out.push({
        startYear,
        yearsInDecade: Math.min(10, lifeExpectancyYears - startYear),
      });
    }
    return out;
  }, [lifeExpectancyYears]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your life, one week at a time
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {stats.currentWeekIndex < 0 ? (
              'Grid starts on your birthday.'
            ) : stats.currentWeekIndex >= totalWeeks ? (
              <>You&apos;re past your estimated lifespan. Adjust it in Settings if you like.</>
            ) : (
              <>
                Week{' '}
                <span className="font-semibold text-neutral-200">
                  {stats.currentWeekIndex.toLocaleString()}
                </span>{' '}
                of{' '}
                <span className="font-semibold text-neutral-200">
                  {totalWeeks.toLocaleString()}
                </span>
                {' · '}
                <span className="font-semibold text-neutral-200">
                  {stats.percentLived.toFixed(1)}%
                </span>{' '}
                lived
              </>
            )}
          </p>
        </div>
        <LifeColorPicker />
      </header>

      <div className="overflow-x-auto">
        <div className="mx-auto w-fit">
          {/* Top-level flex: week-axis column on the left, then one block
              per decade with a year-axis header on top of each. */}
          <div className="flex items-start" style={{ gap: `${DECADE_GAP_PX}px` }}>
            {/* Week axis + corner label */}
            <div
              className="flex flex-col"
              style={{ width: `${WEEK_AXIS_WIDTH_PX}px` }}
            >
              {/* Corner: aligned with the year-axis strip above the grids. */}
              <div
                className="flex items-end justify-end pr-1 text-[0.65rem] uppercase tracking-wide text-neutral-500"
                style={{ height: `${YEAR_AXIS_HEIGHT_PX}px` }}
              >
                Wk
              </div>
              {/* 52 week-label slots, each the height of one row. Labels
                  land every WEEK_TICK_EVERY rows plus the very first row. */}
              <div
                className="grid"
                style={{
                  gridTemplateRows: `repeat(52, ${CELL_PX}px)`,
                  rowGap: `${CELL_GAP_PX}px`,
                }}
              >
                {Array.from({ length: 52 }, (_, w) => {
                  const weekNum = w + 1;
                  const show =
                    weekNum === 1 || weekNum % WEEK_TICK_EVERY === 0;
                  return (
                    <div
                      key={w}
                      className="flex items-center justify-end pr-1 text-[0.6rem] leading-none text-neutral-500"
                    >
                      {show ? weekNum : ''}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Decade blocks */}
            {decades.map(({ startYear, yearsInDecade }, decadeIdx) => (
              <DecadeBlock
                key={decadeIdx}
                startYear={startYear}
                yearsInDecade={yearsInDecade}
                currentWeekIndex={current}
                colors={colors}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Activity shading and session overlays land in later slices
        (MementoMori.md §3.4 / §3.5). Click-a-week notes and milestones too.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Decade block — 10 (or fewer) year-columns × 52 week-rows.
// ---------------------------------------------------------------------------

interface DecadeBlockProps {
  startYear: number;         // 0-indexed year-of-life at this block's left edge
  yearsInDecade: number;     // 1..10
  currentWeekIndex: number;  // clamped
  colors: Record<'lived' | 'thisWeek' | 'remaining', string>;
}

function DecadeBlock({
  startYear,
  yearsInDecade,
  currentWeekIndex,
  colors,
}: DecadeBlockProps) {
  // Build cells in column-major order (year-first, then week-within-year).
  // Using grid-auto-flow: column so the DOM order matches visual order
  // without having to set explicit grid-row/column on each cell.
  const cells = useMemo(() => {
    const out: { idx: number; year: number; week: number }[] = [];
    for (let y = 0; y < yearsInDecade; y++) {
      for (let w = 0; w < 52; w++) {
        out.push({ idx: (startYear + y) * 52 + w, year: startYear + y, week: w });
      }
    }
    return out;
  }, [startYear, yearsInDecade]);

  // Year labels along the top: show every year marker as a tick, and the
  // decade boundary year (startYear + 10, or lifeExpectancyYears on the
  // last block) as a label.
  const yearLabels = useMemo(() => {
    const out: (number | null)[] = [];
    for (let y = 0; y < yearsInDecade; y++) {
      const yearNum = startYear + y + 1; // 1-indexed year of life
      // Label on every 10th year, plus the very last year of the whole grid.
      const isDecadeMark = yearNum % 10 === 0;
      const isFirstYear = yearNum === 1;
      out.push(isDecadeMark || isFirstYear ? yearNum : null);
    }
    return out;
  }, [startYear, yearsInDecade]);

  return (
    <div className="flex flex-col">
      {/* Year axis strip: one slot per year column, labelled at decade
          boundaries. Height matches the week-axis corner above. */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${yearsInDecade}, ${CELL_PX}px)`,
          columnGap: `${CELL_GAP_PX}px`,
          height: `${YEAR_AXIS_HEIGHT_PX}px`,
        }}
      >
        {yearLabels.map((label, i) => (
          <div
            key={i}
            className="flex items-end justify-center text-[0.6rem] leading-none text-neutral-500"
            // Nudge labels right so they sit above the right edge of their
            // column — matches the reference poster where "10" sits over
            // the LAST column of the decade.
          >
            {label ?? ''}
          </div>
        ))}
      </div>

      {/* The cell grid itself. Column-major flow so iteration order
          (year, then week) maps straight to (col, row). */}
      <div
        role="grid"
        aria-label={`Years ${startYear + 1}–${startYear + yearsInDecade}`}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${yearsInDecade}, ${CELL_PX}px)`,
          gridTemplateRows: `repeat(52, ${CELL_PX}px)`,
          gap: `${CELL_GAP_PX}px`,
          gridAutoFlow: 'column',
        }}
      >
        {cells.map(({ idx, year, week }) => {
          const isCurrent = idx === currentWeekIndex;
          const isPast = idx < currentWeekIndex;
          const bg = isCurrent
            ? colors.thisWeek
            : isPast
              ? colors.lived
              : colors.remaining;
          return (
            <div
              key={idx}
              role="gridcell"
              aria-label={`Year ${year + 1}, week ${week + 1}${isCurrent ? ' (current)' : ''}`}
              title={`Year ${year + 1} · Week ${week + 1}`}
              className={
                isCurrent
                  ? 'rounded-[1px] ring-1 ring-emerald-200 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                  : isPast
                    ? 'rounded-[1px]'
                    : 'rounded-[1px] border border-neutral-800'
              }
              style={{ backgroundColor: bg }}
            />
          );
        })}
      </div>
    </div>
  );
}
