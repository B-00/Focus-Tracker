import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../lib/me-api';
import { computeLifeStats, parseBirthday, weekRange } from '../lib/life-math';
import { useLifeColors } from '../lib/life-colors';
import { LIFE_SIZE_PRESETS, useLifeSize } from '../lib/life-size';
import { LifeColorPicker } from './life/LifeColorPicker';
import { LifeSizePicker } from './life/LifeSizePicker';

// /life — Memento Mori life calendar (MementoMori.md §3.1).
//
// Layout (matches the physical poster):
//   * Y axis = years (top→bottom, 1 to lifeExpectancyYears).
//   * X axis = weeks within the year (left→right, 1..52).
//   * Row gap every 10 years to group decades visually.
//   * Column gap at week 26/27 to split the year in half.
//
// ponytail (perf): BOTH colors and sizes are passed to cells as CSS
// variables on an ancestor <main>, not as React props. Dragging a color
// swatch or picking a new size is one CSS-var write + browser repaint;
// no React re-render of thousands of memo'd cells. DecadeRow + HalfGrid
// are React.memo'd on their index-only props so the ancestor style
// change doesn't cascade into the subtree.

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
//  Grid shell — publishes the color palette AND size preset as CSS vars.
//  Chunks years into decade blocks. No overflow wrapper — the page
//  itself scrolls if the grid outgrows the viewport.
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
  const sizeKey = useLifeSize();
  const size = LIFE_SIZE_PRESETS[sizeKey];

  const totalWeeks = stats.totalWeeks;
  // Clamp currentWeekIndex into [0, totalWeeks) so a future birthday or an
  // already-exceeded lifespan still renders a sensible "current" cell.
  const current = Math.max(0, Math.min(totalWeeks - 1, stats.currentWeekIndex));

  // ---- Hover tooltip state. See HourlyBreakdown.tsx for the inspiration
  // pattern. Stored at this level so the tooltip component is a sibling
  // of the grid (position: fixed anchored via the cell's client rect).
  // Setter is useCallback'd for stable identity — HalfGrid is memo'd and
  // we need the callback prop reference to be stable so hover updates
  // don't bust the memo and re-render the ~5000 cell subtree.
  const [hover, setHover] = useState<HoverState | null>(null);
  const onCellHover = useCallback<HalfGridCellHover>((idx, rect) => {
    setHover({ idx, rect });
  }, []);
  const onGridLeave = useCallback(() => setHover(null), []);

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

  // ponytail (perf): publish 3 colors + 5 size dimensions as CSS vars.
  // Cells + axis strips reference them via var(...) so a picker change
  // is a single style update on <main> and a browser repaint — not a
  // React re-render of the ~5000 cell subtree.
  const cssVars = {
    '--c-lived': colors.lived,
    '--c-this': colors.thisWeek,
    '--c-rem': colors.remaining,
    '--cell': `${size.cell}px`,
    '--cell-gap': `${size.gap}px`,
    '--block-gap': `${size.blockGap}px`,
    '--axis-font': size.axisFont,
    '--year-axis-w': `${size.axisW}px`,
    '--week-axis-h': `${size.axisH}px`,
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
        <div className="flex items-start gap-2">
          <LifeSizePicker />
          <LifeColorPicker />
        </div>
      </header>

      {/* No overflow wrapper — the page's own scroll handles any grid
          wider than the viewport. Nested overflow-x: auto forces
          overflow-y to auto per CSS spec and that's the internal
          scrollbar we just killed. */}
      <div className="mx-auto w-fit" onMouseLeave={onGridLeave}>
        <div className="flex items-start" style={{ gap: 'var(--cell-gap)' }}>
          <YearAxis decades={decades} />

          <div>
            <WeekAxisTop />
            <div className="flex flex-col" style={{ gap: 'var(--block-gap)' }}>
              {decades.map(({ startYear, yearsInDecade }, decadeIdx) => (
                <DecadeRow
                  key={decadeIdx}
                  startYear={startYear}
                  yearsInDecade={yearsInDecade}
                  currentWeekIndex={current}
                  onCellHover={onCellHover}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {hover && (
        <CellTooltip
          idx={hover.idx}
          rect={hover.rect}
          birthday={birthday}
          currentWeekIndex={current}
          preset={size.tooltip}
        />
      )}

      <p className="mt-6 text-xs text-neutral-500">
        Activity shading and session overlays land in later slices
        (MementoMori.md §3.4 / §3.5). Click-a-week notes and milestones too.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Axis strips — kept outside the cell grids so cells stay uniform.
//  All dimensions are CSS vars so a size-preset switch just repaints.
// ---------------------------------------------------------------------------

function WeekAxisTop() {
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
    <div
      className="flex"
      style={{ gap: 'var(--block-gap)', height: 'var(--week-axis-h)' }}
    >
      <AxisRow labels={leftLabels} />
      <AxisRow labels={rightLabels} />
    </div>
  );
}

const AxisRow = memo(function AxisRow({ labels }: { labels: (number | null)[] }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${labels.length}, var(--cell))`,
        columnGap: 'var(--cell-gap)',
      }}
    >
      {labels.map((label, i) => (
        <div
          key={i}
          className="flex items-end justify-center leading-none text-neutral-500"
          style={{ fontSize: 'var(--axis-font)' }}
        >
          {label ?? ''}
        </div>
      ))}
    </div>
  );
});

interface YearAxisProps {
  decades: { startYear: number; yearsInDecade: number }[];
}

const YearAxis = memo(function YearAxis({ decades }: YearAxisProps) {
  return (
    <div
      className="flex flex-col"
      style={{
        width: 'var(--year-axis-w)',
        // Match the top padding of the weekly axis so row 1 aligns with
        // the first cell in the grid.
        paddingTop: 'var(--week-axis-h)',
        gap: 'var(--block-gap)',
      }}
    >
      {decades.map(({ startYear, yearsInDecade }, i) => (
        <YearAxisBlock key={i} startYear={startYear} yearsInDecade={yearsInDecade} />
      ))}
    </div>
  );
});

const YearAxisBlock = memo(function YearAxisBlock({
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
        gridTemplateRows: `repeat(${yearsInDecade}, var(--cell))`,
        rowGap: 'var(--cell-gap)',
      }}
    >
      {Array.from({ length: yearsInDecade }, (_, y) => {
        const yearNum = startYear + y + 1; // 1-indexed year of life
        // Label year 1 and every 10th year — the decade boundaries.
        const show = yearNum === 1 || yearNum % YEARS_PER_DECADE === 0;
        return (
          <div
            key={y}
            className="flex items-center justify-end pr-1 leading-none text-neutral-500"
            style={{ fontSize: 'var(--axis-font)' }}
          >
            {show ? yearNum : ''}
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
//  DecadeRow + HalfGrid — memo'd so color/size-store updates don't cascade.
//  Cells inside read CSS vars rather than React props for the background.
// ---------------------------------------------------------------------------

interface HoverRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface HoverState {
  idx: number;
  rect: HoverRect;
}

/// Shared cell-hover callback signature. useCallback'd at LifeGrid and
/// threaded down so React.memo on DecadeRow + HalfGrid holds.
type HalfGridCellHover = (idx: number, rect: HoverRect) => void;

interface DecadeRowProps {
  startYear: number;
  yearsInDecade: number;
  currentWeekIndex: number;
  onCellHover: HalfGridCellHover;
}

const DecadeRow = memo(function DecadeRow({
  startYear,
  yearsInDecade,
  currentWeekIndex,
  onCellHover,
}: DecadeRowProps) {
  return (
    <div className="flex" style={{ gap: 'var(--block-gap)' }}>
      <HalfGrid
        startYear={startYear}
        yearsInDecade={yearsInDecade}
        weekStart={0}
        weekCount={HALF_WEEKS}
        currentWeekIndex={currentWeekIndex}
        onCellHover={onCellHover}
      />
      <HalfGrid
        startYear={startYear}
        yearsInDecade={yearsInDecade}
        weekStart={HALF_WEEKS}
        weekCount={HALF_WEEKS}
        currentWeekIndex={currentWeekIndex}
        onCellHover={onCellHover}
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
  onCellHover: HalfGridCellHover;
}

const HalfGrid = memo(function HalfGrid({
  startYear,
  yearsInDecade,
  weekStart,
  weekCount,
  currentWeekIndex,
  onCellHover,
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

  // One handler per HalfGrid — closes over onCellHover (stable). Reads
  // the DOMRect from currentTarget for pixel-perfect tooltip anchoring.
  const handleEnter = (idx: number) => (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onCellHover(idx, { left: r.left, top: r.top, width: r.width, height: r.height });
  };

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
        gridTemplateColumns: `repeat(${weekCount}, var(--cell))`,
        gridTemplateRows: `repeat(${yearsInDecade}, var(--cell))`,
        gap: 'var(--cell-gap)',
      }}
    >
      {cells.map(({ idx, year, week }) => {
        const isCurrent = idx === currentWeekIndex;
        const isPast = idx < currentWeekIndex;
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
            onMouseEnter={handleEnter(idx)}
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

// ---------------------------------------------------------------------------
//  CellTooltip — same visual pattern as HourlyBreakdown's chart tooltip.
//  Anchored to the hovered cell via position: fixed + the client rect
//  grabbed on mouseEnter. Clamped to the viewport so right/bottom-edge
//  cells don't push the tooltip off-screen. Dimensions scale with the
//  active LifeSize preset so the tooltip stays proportionate to the
//  grid (a 192px tooltip over 20px XL cells looks cramped; an 8px S
//  cell over a 272px tooltip looks silly).
// ---------------------------------------------------------------------------

const TOOLTIP_GAP = 8;    // gap between cell edge and tooltip

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

interface CellTooltipPreset {
  w: number;
  h: number;
  pad: string;
  headerFont: string;
  valueFont: string;
  detailFont: string;
}

interface CellTooltipProps {
  idx: number;
  rect: HoverRect;
  birthday: Date;
  currentWeekIndex: number;
  preset: CellTooltipPreset;
}

function CellTooltip({
  idx,
  rect,
  birthday,
  currentWeekIndex,
  preset,
}: CellTooltipProps) {
  const year = Math.floor(idx / WEEKS_PER_YEAR);
  const weekInYear = idx % WEEKS_PER_YEAR;
  const { start, end } = weekRange(birthday, idx);
  // weekRange's `end` is exclusive (start + 7 days). Show the inclusive
  // last day of the week in the range label, i.e. end - 1 day.
  const inclusiveEnd = new Date(end.getTime() - 86_400_000);
  const rangeLabel = `${DATE_FMT.format(start)} – ${DATE_FMT.format(inclusiveEnd)}`;

  const delta = idx - currentWeekIndex;
  const relLabel =
    delta === 0 ? 'this week' : delta < 0 ? `${-delta} weeks ago` : `in ${delta} weeks`;

  // Anchor above the cell; clamp to viewport so edges don't cut off.
  const anchorX = rect.left + rect.width / 2;
  const anchorY = rect.top;
  let left = anchorX - preset.w / 2;
  left = Math.max(8, Math.min(window.innerWidth - preset.w - 8, left));
  let top = anchorY - TOOLTIP_GAP - preset.h;
  if (top < 8) {
    // Flip below the cell if there's no room above.
    top = anchorY + rect.height + TOOLTIP_GAP;
  }

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-neutral-700 bg-neutral-900/95 shadow-lg backdrop-blur"
      style={{ left, top, width: preset.w, padding: preset.pad }}
    >
      <p
        className="uppercase tracking-wider text-neutral-500"
        style={{ fontSize: preset.headerFont }}
      >
        Life week
      </p>
      <p
        className="mt-0.5 text-neutral-400"
        style={{ fontSize: preset.headerFont }}
      >
        {rangeLabel}
      </p>
      <p
        className="mt-1 font-mono tabular-nums font-semibold text-neutral-100"
        style={{ fontSize: preset.valueFont }}
      >
        Week {(idx + 1).toLocaleString()}
      </p>
      <p
        className="mt-1 text-neutral-300"
        style={{ fontSize: preset.detailFont }}
      >
        Year {year + 1} · Week {weekInYear + 1} of {WEEKS_PER_YEAR}
      </p>
      <p
        className="mt-0.5 text-neutral-500"
        style={{ fontSize: preset.headerFont }}
      >
        {relLabel}
      </p>
    </div>
  );
}
