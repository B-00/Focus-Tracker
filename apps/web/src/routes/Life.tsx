import { memo, useMemo, type CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../lib/me-api';
import { computeLifeStats, parseBirthday } from '../lib/life-math';
import { useLifeColors } from '../lib/life-colors';
import { LifeColorPicker } from './life/LifeColorPicker';

// /life — Memento Mori life calendar (MementoMori.md §3.1).
//
// Layout (matches the physical poster):
//   * Y axis = years (top→bottom, 1 to lifeExpectancyYears).
//   * X axis = weeks within the year (left→right, 1..52).
//   * Row gap every 10 years to group decades visually.
//   * Column gap at week 26/27 to split the year in half.
//
// ponytail (perf): colors are passed to cells as CSS variables on an
// ancestor, not as React props. The cell DOM never changes when a
// swatch is dragged — only the browser repaints the resolved color.
// DecadeRow + HalfGrid are React.memo'd on their index props so a
// colors-store notification won't re-render ~5000 cell divs on every
// drag tick. The picker itself stays spec-identical to the tasks
// picker (native <input type=color>, same store contract).

const CELL_PX = 10;
const CELL_GAP_PX = 2;
const DECADE_GAP_PX = 10;    // between every block of 10 years (Y axis)
const HALF_GAP_PX = 10;      // single mid-year gap at week 26/27 (X axis)
const YEAR_AXIS_WIDTH_PX = 32;
const WEEK_AXIS_HEIGHT_PX = 18;

const WEEKS_PER_YEAR = 52;
const HALF_WEEKS = 26;       // first half: weeks 1..26; second half: weeks 27..52
const YEARS_PER_DECADE = 10;
const WEEK_TICK_EVERY = 5;   // label week 1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50

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
//  Grid shell — publishes the color palette as CSS vars so cells don't need
//  to re-render on palette change. Chunks years into decade blocks.
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

  // Chunk the years into decade blocks. Last block may be short if
  // lifeExpectancyYears isn't a multiple of 10 (e.g. 85 → 8 full + 1 half).
  const decades = useMemo(() => {
    const out: { startYear: number; yearsInDecade: number }[] = [];
    for (let startYear = 0; startYear < lifeExpectancyYears; startYear += YEARS_PER_DECADE) {
      out.push({
        startYear,
        yearsInDecade: Math.min(YEARS_PER_DECADE, lifeExpectancyYears - startYear),
      });
    }
    return out;
  }, [lifeExpectancyYears]);

  // ponytail (perf): publishing the 3 user colors as CSS vars means dragging
  // a swatch is a single CSS-variable update + browser repaint — not a
  // React re-render of thousands of cells. Downstream DecadeRow/HalfGrid
  // are memo'd on their index-only props so this style change on <main>
  // doesn't cascade.
  const cssVars = {
    '--c-lived': colors.lived,
    '--c-this': colors.thisWeek,
    '--c-rem': colors.remaining,
  } as CSSProperties;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8" style={cssVars}>
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
          {/* Outer flex: year-axis column on the left, then (week-axis +
              decade rows) on the right. */}
          <div className="flex items-start" style={{ gap: `${CELL_GAP_PX * 2}px` }}>
            <YearAxis decades={decades} />

            <div>
              <WeekAxisTop />
              <div className="flex flex-col" style={{ gap: `${DECADE_GAP_PX}px` }}>
                {decades.map(({ startYear, yearsInDecade }, decadeIdx) => (
                  <DecadeRow
                    key={decadeIdx}
                    startYear={startYear}
                    yearsInDecade={yearsInDecade}
                    currentWeekIndex={current}
                  />
                ))}
              </div>
            </div>
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
//  Axis strips — kept outside the cell grids so cells stay uniform.
// ---------------------------------------------------------------------------

function WeekAxisTop() {
  // Two-half layout matching the grid below: 26 week slots + mid-gap +
  // 26 week slots. Labels at week 1 + every 5 weeks, plus the two
  // halves' boundary weeks (26 implicit, 27 implicit — we skip them so
  // the gap stays clean).
  const leftLabels: (number | null)[] = [];
  for (let w = 0; w < HALF_WEEKS; w++) {
    const weekNum = w + 1;
    const show = weekNum === 1 || weekNum % WEEK_TICK_EVERY === 0;
    leftLabels.push(show ? weekNum : null);
  }
  const rightLabels: (number | null)[] = [];
  for (let w = 0; w < HALF_WEEKS; w++) {
    const weekNum = HALF_WEEKS + w + 1; // 27..52
    const show = weekNum % WEEK_TICK_EVERY === 0 || weekNum === WEEKS_PER_YEAR;
    rightLabels.push(show ? weekNum : null);
  }

  return (
    <div className="flex" style={{ gap: `${HALF_GAP_PX}px`, height: `${WEEK_AXIS_HEIGHT_PX}px` }}>
      <AxisRow labels={leftLabels} />
      <AxisRow labels={rightLabels} />
    </div>
  );
}

function AxisRow({ labels }: { labels: (number | null)[] }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${labels.length}, ${CELL_PX}px)`,
        columnGap: `${CELL_GAP_PX}px`,
      }}
    >
      {labels.map((label, i) => (
        <div
          key={i}
          className="flex items-end justify-center text-[0.6rem] leading-none text-neutral-500"
        >
          {label ?? ''}
        </div>
      ))}
    </div>
  );
}

interface YearAxisProps {
  decades: { startYear: number; yearsInDecade: number }[];
}

function YearAxis({ decades }: YearAxisProps) {
  return (
    <div
      className="flex flex-col"
      style={{
        width: `${YEAR_AXIS_WIDTH_PX}px`,
        // Match the top padding of the weekly axis so row 1 aligns with
        // the first cell in the grid.
        paddingTop: `${WEEK_AXIS_HEIGHT_PX}px`,
        gap: `${DECADE_GAP_PX}px`,
      }}
    >
      {decades.map(({ startYear, yearsInDecade }, i) => (
        <YearAxisBlock key={i} startYear={startYear} yearsInDecade={yearsInDecade} />
      ))}
    </div>
  );
}

function YearAxisBlock({
  startYear,
  yearsInDecade,
}: {
  startYear: number;
  yearsInDecade: number;
}) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: `repeat(${yearsInDecade}, ${CELL_PX}px)`,
        rowGap: `${CELL_GAP_PX}px`,
      }}
    >
      {Array.from({ length: yearsInDecade }, (_, y) => {
        const yearNum = startYear + y + 1; // 1-indexed year of life
        // Label year 1 and every 10th year — the decade boundaries.
        const show = yearNum === 1 || yearNum % YEARS_PER_DECADE === 0;
        return (
          <div
            key={y}
            className="flex items-center justify-end pr-1 text-[0.6rem] leading-none text-neutral-500"
          >
            {show ? yearNum : ''}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  DecadeRow + HalfGrid — memo'd so color-store updates don't cascade.
//  Cells inside read CSS vars rather than React props for the background.
// ---------------------------------------------------------------------------

interface DecadeRowProps {
  startYear: number;
  yearsInDecade: number;
  currentWeekIndex: number;
}

const DecadeRow = memo(function DecadeRow({
  startYear,
  yearsInDecade,
  currentWeekIndex,
}: DecadeRowProps) {
  return (
    <div className="flex" style={{ gap: `${HALF_GAP_PX}px` }}>
      <HalfGrid
        startYear={startYear}
        yearsInDecade={yearsInDecade}
        weekStart={0}
        weekCount={HALF_WEEKS}
        currentWeekIndex={currentWeekIndex}
      />
      <HalfGrid
        startYear={startYear}
        yearsInDecade={yearsInDecade}
        weekStart={HALF_WEEKS}
        weekCount={HALF_WEEKS}
        currentWeekIndex={currentWeekIndex}
      />
    </div>
  );
});

interface HalfGridProps {
  startYear: number;
  yearsInDecade: number;
  weekStart: number;   // 0 or 26
  weekCount: number;   // 26
  currentWeekIndex: number;
}

const HalfGrid = memo(function HalfGrid({
  startYear,
  yearsInDecade,
  weekStart,
  weekCount,
  currentWeekIndex,
}: HalfGridProps) {
  // Default grid-auto-flow is 'row' — iterate year (row) first, then week
  // (col). DOM order matches visual order so no explicit grid-row/column
  // placement is needed.
  const cells = useMemo(() => {
    const out: { idx: number; year: number; week: number }[] = [];
    for (let y = 0; y < yearsInDecade; y++) {
      for (let w = 0; w < weekCount; w++) {
        const weekInYear = weekStart + w;
        out.push({
          idx: (startYear + y) * WEEKS_PER_YEAR + weekInYear,
          year: startYear + y,
          week: weekInYear,
        });
      }
    }
    return out;
  }, [startYear, yearsInDecade, weekStart, weekCount]);

  return (
    <div
      role="grid"
      aria-label={
        weekStart === 0
          ? `Years ${startYear + 1}–${startYear + yearsInDecade}, weeks 1–${HALF_WEEKS}`
          : `Years ${startYear + 1}–${startYear + yearsInDecade}, weeks ${HALF_WEEKS + 1}–${WEEKS_PER_YEAR}`
      }
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${weekCount}, ${CELL_PX}px)`,
        gridTemplateRows: `repeat(${yearsInDecade}, ${CELL_PX}px)`,
        gap: `${CELL_GAP_PX}px`,
      }}
    >
      {cells.map(({ idx, year, week }) => {
        const isCurrent = idx === currentWeekIndex;
        const isPast = idx < currentWeekIndex;
        // CSS-variable backgrounds — see the ponytail note on LifeGrid for
        // why this matters for picker lag.
        const bg = isCurrent
          ? 'var(--c-this)'
          : isPast
            ? 'var(--c-lived)'
            : 'var(--c-rem)';
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
  );
});
