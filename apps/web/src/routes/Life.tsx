import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { lifeHeatmapTier, type LifeGridResponse } from '@focus-tracker/shared';
import { fetchMeProfile, meQueryKeys } from '../lib/me-api';
import { fetchLifeGrid, lifeQueryKeys } from '../lib/life-api';
import { computeLifeStats, parseBirthday, weekRange } from '../lib/life-math';
import { useLifeColors } from '../lib/life-colors';
import { LIFE_SIZE_PRESETS, useLifeSize } from '../lib/life-size';
import { LifeColorPicker } from './life/LifeColorPicker';
import { LifeSizePicker } from './life/LifeSizePicker';
import { LifeHeatmapColorPicker } from './life/LifeHeatmapColorPicker';
import { LifeMilestoneColorPicker } from './life/LifeMilestoneColorPicker';
import { LifeWeekModal } from './life/LifeWeekModal';
import { LifeWeekFutureModal } from './life/LifeWeekFutureModal';
import { fetchMilestones, milestoneQueryKeys } from '../lib/milestones-api';
import { MilestoneMarker } from './life/MilestoneMarker';
import type { Milestone } from '@focus-tracker/shared';

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
//
// Slice 2.1 (§4.2 revised): past cells with data are shaded by 4
// telemetry-minute tiers (user-pickable via LifeHeatmapColorPicker).
// Focus-session overlay was removed; "pre-tracking" and "measured idle"
// collapse into a single empty state using --c-lived.

const WEEKS_PER_YEAR = 52;
const HALF_WEEKS = 26;       // first half: weeks 1..26; second half: weeks 27..52
const YEARS_PER_DECADE = 10;
const WEEK_TICK_EVERY = 5;   // label week 1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50

export function LifePage() {
  const profileQuery = useQuery({
    queryKey: meQueryKeys.profile(),
    queryFn: fetchMeProfile,
  });

  // Grid endpoint is cheap (one request, ~thousands of ints). Only enable
  // once the birthday is known — endpoint returns an empty response
  // without one but there's no reason to make the call.
  const gridQuery = useQuery({
    queryKey: lifeQueryKeys.grid(),
    queryFn: fetchLifeGrid,
    enabled: Boolean(profileQuery.data?.birthday),
    staleTime: 60_000, // one minute; on-read backend refresh handles sub-minute freshness
  });

  if (profileQuery.isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-neutral-500">Loading your life calendar…</p>
      </main>
    );
  }

  if (profileQuery.isError) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          Failed to load profile:{' '}
          {profileQuery.error instanceof Error ? profileQuery.error.message : 'unknown error'}
        </div>
      </main>
    );
  }

  const birthday = parseBirthday(profileQuery.data?.birthday);
  if (!birthday || !profileQuery.data) return <BirthdayOnboarding />;

  return (
    <LifeGrid
      birthday={birthday}
      lifeExpectancyYears={profileQuery.data.lifeExpectancyYears}
      grid={gridQuery.data}
    />
  );
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
  grid?: LifeGridResponse;
}

/// Payload held by the per-week map. Pre-looked-up tier so cells don't
/// re-compute it on every render.
interface WeekPayload {
  minutes: number;
  tier: 0 | 1 | 2 | 3 | 4;
}

type GridDataMap = ReadonlyMap<number, WeekPayload>;

function LifeGrid({ birthday, lifeExpectancyYears, grid }: GridProps) {
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

  // Build a stable Map from the grid response. Memoised on the grid
  // object reference so DecadeRow/HalfGrid memo holds across unrelated
  // re-renders (color picker, size picker, tooltip hover).
  const gridData = useMemo<GridDataMap>(() => {
    const m = new Map<number, WeekPayload>();
    if (!grid) return m;
    for (const w of grid.weeks) {
      m.set(w.weekIndex, {
        minutes: w.telemetryMinutes,
        tier: lifeHeatmapTier(w.telemetryMinutes),
      });
    }
    return m;
  }, [grid]);

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

  // Click-to-open-week modal state. All cells are activatable now
  // (MementoMori.md §5.1 past, §5.2 current, §5.3 future). A single
  // openWeekIndex drives either the past/current drawer or the
  // future-week milestones modal depending on where the week sits
  // relative to the current week. Handlers are useCallback'd so the
  // memo'd DecadeRow / HalfGrid subtrees don't re-render on each open.
  const [openWeekIndex, setOpenWeekIndex] = useState<number | null>(null);
  const onCellActivate = useCallback<HalfGridCellActivate>(
    (idx) => setOpenWeekIndex(idx),
    [],
  );
  const onCloseWeek = useCallback(() => setOpenWeekIndex(null), []);
  const openIsFuture = openWeekIndex !== null && openWeekIndex > current;
  const openIsPastOrCurrent = openWeekIndex !== null && openWeekIndex <= current;

  // Milestones: single query, bin by weekIndex so each HalfGrid can
  // look up its week's markers in O(1). The query is enabled always
  // (not gated on grid data) so markers paint as soon as they load.
  const milestonesQuery = useQuery({
    queryKey: milestoneQueryKeys.list(),
    queryFn: fetchMilestones,
    staleTime: 60_000,
  });
  const milestonesByWeek = useMemo<ReadonlyMap<number, Milestone[]>>(() => {
    const m = new Map<number, Milestone[]>();
    for (const row of milestonesQuery.data ?? []) {
      const bucket = m.get(row.weekIndex);
      if (bucket) bucket.push(row);
      else m.set(row.weekIndex, [row]);
    }
    return m;
  }, [milestonesQuery.data]);

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

  // ponytail (perf): publish 3 grid roles + 4 heatmap roles + 3
  // milestone-count roles + 5 size dimensions as CSS vars. Cells +
  // axis strips + milestone dots reference them via var(...) so a
  // picker change is a single style update on <main> and a browser
  // repaint — not a React re-render of the ~5000 cell subtree.
  const cssVars = {
    '--c-lived': colors.lived,
    '--c-this': colors.thisWeek,
    '--c-rem': colors.remaining,
    '--c-h1': colors.h1,
    '--c-h2': colors.h2,
    '--c-h3': colors.h3,
    '--c-h4': colors.h4,
    '--c-m1': colors.m1,
    '--c-m2': colors.m2,
    '--c-m3': colors.m3,
    '--cell': `${size.cell}px`,
    '--cell-gap': `${size.gap}px`,
    '--block-gap': `${size.blockGap}px`,
    '--axis-font': size.axisFont,
    '--year-axis-w': `${size.axisW}px`,
    '--week-axis-h': `${size.axisH}px`,
  } as CSSProperties;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8" style={cssVars}>
      <header className="mb-6">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Your life, one week at a time
        </h1>
      </header>

      {/* Responsive layout:
          • < xl  (tablet / smaller) — flex column. Pickers sit above
            the grid, right-aligned, with each inner picker back to a
            horizontal row of swatches (handled inside the pickers via
            `xl:` classes). Order swap via order-1/order-2 puts the
            aside on top even though it comes second in markup.
          • ≥ xl (desktop)          — 3-col CSS grid [1fr spacer] [auto
            grid] [1fr aside]. The two 1fr rails push equally from both
            sides so the middle 'auto' column (the life grid) stays
            horizontally centred in <main> regardless of rail width,
            and the aside goes sticky.
          No overflow wrapper either way — the page's own scroll
          handles any grid wider than the viewport. */}
      <div className="flex flex-col items-center gap-6 xl:grid xl:grid-cols-[1fr_auto_1fr] xl:items-start">
        <div aria-hidden="true" className="hidden xl:block" />
        <div className="order-2 w-fit xl:order-none" onMouseLeave={onGridLeave}>
          <p className="mb-2 text-base text-neutral-400">
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
                  gridData={gridData}
                  milestonesByWeek={milestonesByWeek}
                  onCellHover={onCellHover}
                  onCellActivate={onCellActivate}
                />
              ))}
              </div>
            </div>
          </div>
        </div>

        <aside
          aria-label="Life grid settings"
          // < xl: wraps naturally in a row above the grid, right-aligned.
          // ≥ xl: sticky right rail, pickers stacked vertically. top-16
          // (64px) = AppShell's h-12 sticky nav (48px) + 16px breathing
          // room so the rail clears the nav while scrolling the long
          // grid. justify-self-end hugs the right edge of its 1fr column.
          className="order-1 flex w-full flex-row flex-wrap items-start justify-end gap-2 xl:order-none xl:sticky xl:top-16 xl:w-auto xl:flex-col xl:justify-start xl:self-start xl:justify-self-end"
        >
          <LifeSizePicker />
          <LifeColorPicker />
          <LifeHeatmapColorPicker />
          <LifeMilestoneColorPicker />
        </aside>
      </div>

      {hover && (
        <CellTooltip
          idx={hover.idx}
          rect={hover.rect}
          birthday={birthday}
          currentWeekIndex={current}
          preset={size.tooltip}
          payload={gridData.get(hover.idx) ?? null}
          milestones={milestonesByWeek.get(hover.idx) ?? null}
        />
      )}

      <LifeWeekModal
        weekIndex={openIsPastOrCurrent ? openWeekIndex : null}
        onClose={onCloseWeek}
      />
      <LifeWeekFutureModal
        weekIndex={openIsFuture ? openWeekIndex : null}
        birthday={grid?.birthday ?? birthday.toISOString().slice(0, 10)}
        onClose={onCloseWeek}
      />
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
/// Click / Enter / Space activation — opens the per-week detail modal.
type HalfGridCellActivate = (idx: number) => void;

type MilestonesByWeek = ReadonlyMap<number, Milestone[]>;

interface DecadeRowProps {
  startYear: number;
  yearsInDecade: number;
  currentWeekIndex: number;
  gridData: GridDataMap;
  milestonesByWeek: MilestonesByWeek;
  onCellHover: HalfGridCellHover;
  onCellActivate: HalfGridCellActivate;
}

const DecadeRow = memo(function DecadeRow({
  startYear,
  yearsInDecade,
  currentWeekIndex,
  gridData,
  milestonesByWeek,
  onCellHover,
  onCellActivate,
}: DecadeRowProps) {
  return (
    <div className="flex" style={{ gap: 'var(--block-gap)' }}>
      <HalfGrid
        startYear={startYear}
        yearsInDecade={yearsInDecade}
        weekStart={0}
        weekCount={HALF_WEEKS}
        currentWeekIndex={currentWeekIndex}
        gridData={gridData}
        milestonesByWeek={milestonesByWeek}
        onCellHover={onCellHover}
        onCellActivate={onCellActivate}
      />
      <HalfGrid
        startYear={startYear}
        yearsInDecade={yearsInDecade}
        weekStart={HALF_WEEKS}
        weekCount={HALF_WEEKS}
        currentWeekIndex={currentWeekIndex}
        gridData={gridData}
        milestonesByWeek={milestonesByWeek}
        onCellHover={onCellHover}
        onCellActivate={onCellActivate}
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
  gridData: GridDataMap;
  milestonesByWeek: MilestonesByWeek;
  onCellHover: HalfGridCellHover;
  onCellActivate: HalfGridCellActivate;
}

const HalfGrid = memo(function HalfGrid({
  startYear,
  yearsInDecade,
  weekStart,
  weekCount,
  currentWeekIndex,
  gridData,
  milestonesByWeek,
  onCellHover,
  onCellActivate,
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
  const handleClick = (idx: number) => () => onCellActivate(idx);
  const handleKey = (idx: number) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Enter / Space open the per-week modal; matches §8 keyboard spec.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCellActivate(idx);
    }
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
        const payload = isPast ? gridData.get(idx) : undefined;
        const bg = resolveCellBg(isCurrent, isPast, payload);
        // All cells are activatable (past → detail drawer, current →
        // detail drawer, future → milestone modal). See MementoMori.md
        // §5.1 / §5.2 / §5.3.
        const weekMilestones = milestonesByWeek.get(idx);
        return (
          <div
            key={idx}
            role="gridcell"
            aria-label={cellAriaLabel(year, week, isCurrent, payload, weekMilestones)}
            tabIndex={0}
            onMouseEnter={handleEnter(idx)}
            onClick={handleClick(idx)}
            onKeyDown={handleKey(idx)}
            className={`relative cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-300/70 ${
              isCurrent
                ? 'rounded-[1px] ring-1 ring-emerald-200 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                : isPast
                  ? 'rounded-[1px]'
                  : 'rounded-[1px] border border-neutral-800'
            }`}
            style={{ backgroundColor: bg }}
          >
            {weekMilestones && weekMilestones.length > 0 && (
              <MilestoneMarker count={weekMilestones.length} />
            )}
          </div>
        );
      })}
    </div>
  );
});

function resolveCellBg(
  isCurrent: boolean,
  isPast: boolean,
  payload: WeekPayload | undefined,
): string {
  if (isCurrent) return 'var(--c-this)';
  if (!isPast) return 'var(--c-rem)';
  // Past cell. Empty (no row) OR measured-idle (tier 0) both read as
  // --c-lived — unified empty state per Slice 2.1.
  if (!payload || payload.tier === 0) return 'var(--c-lived)';
  return `var(--c-h${payload.tier})`;
}

function cellAriaLabel(
  year: number,
  week: number,
  isCurrent: boolean,
  payload: WeekPayload | undefined,
  milestones: Milestone[] | undefined,
): string {
  const parts: string[] = [`Year ${year + 1}, week ${week + 1}`];
  if (isCurrent) parts.push('(current)');
  if (payload) parts.push(`${payload.minutes} active min`);
  if (milestones && milestones.length > 0) {
    parts.push(`${milestones.length} milestone${milestones.length === 1 ? '' : 's'}: ${milestones.map((m) => m.label).join(', ')}`);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
//  CellTooltip — same visual pattern as HourlyBreakdown's chart tooltip.
//  Anchored to the hovered cell via position: fixed + the client rect
//  grabbed on mouseEnter. Clamped to the viewport so right/bottom-edge
//  cells don't push the tooltip off-screen. Dimensions scale with the
//  active LifeSize preset so the tooltip stays proportionate to the grid.
// ---------------------------------------------------------------------------

// Gap between cell edge and the tooltip body. Needs to clear the OS
// cursor glyph (usually 20–30px) so the tooltip doesn't sit on top of
// the arrow. 40px lands the tooltip a comfortable distance above the
// hovered cell on every size preset.
const TOOLTIP_GAP = 20;

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
  payload: WeekPayload | null;
  milestones: Milestone[] | null;
}

function CellTooltip({
  idx,
  rect,
  birthday,
  currentWeekIndex,
  preset,
  payload,
  milestones,
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

  // Activity line — only meaningful for past weeks. "no activity"
  // covers both pre-tracking and measured-idle (unified visually too).
  const isPast = idx < currentWeekIndex;
  const activityLabel = isPast
    ? payload
      ? formatActivity(payload.minutes)
      : 'no activity'
    : null;

  // Horizontal: center over the cell; clamp to viewport so edges
  // don't cut off.
  const anchorX = rect.left + rect.width / 2;
  let left = anchorX - preset.w / 2;
  left = Math.max(8, Math.min(window.innerWidth - preset.w - 8, left));

  // Vertical: prefer above the cell. Anchor the tooltip's *bottom*
  // edge via translateY(-100%) so TOOLTIP_GAP is exact regardless of
  // the tooltip's actual content height — preset.h is only used to
  // decide whether we have viewport room above, not to position.
  const topIfAbove = rect.top - TOOLTIP_GAP - preset.h;
  const above = topIfAbove >= 8;
  const top = above ? rect.top - TOOLTIP_GAP : rect.top + rect.height + TOOLTIP_GAP;
  const transform = above ? 'translateY(-100%)' : 'none';

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-neutral-700 bg-neutral-900/95 shadow-lg backdrop-blur"
      style={{ left, top, width: preset.w, padding: preset.pad, transform }}
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
      {activityLabel && (
        <p
          className="mt-1 text-neutral-300"
          style={{ fontSize: preset.detailFont }}
        >
          {activityLabel}
        </p>
      )}
      {milestones && milestones.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {milestones.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-1 text-neutral-200"
              style={{ fontSize: preset.detailFont }}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: m.color }}
                aria-hidden
              />
              <span className="truncate">{m.label}</span>
            </li>
          ))}
        </ul>
      )}
      <p
        className="mt-0.5 text-neutral-500"
        style={{ fontSize: preset.headerFont }}
      >
        {relLabel}
      </p>
    </div>
  );
}

/// `42 min` / `3.5 h` / `18 h` — units flip at the natural reading
/// boundaries so small weeks don't read as "0.7 h" and huge weeks don't
/// read as "4200 min". Zero is special-cased for clarity.
function formatActivity(minutes: number): string {
  if (minutes <= 0) return 'no activity';
  if (minutes < 60) return `${minutes} min active`;
  const hours = minutes / 60;
  if (hours < 10) return `${hours.toFixed(1)} h active`;
  return `${Math.round(hours)} h active`;
}
