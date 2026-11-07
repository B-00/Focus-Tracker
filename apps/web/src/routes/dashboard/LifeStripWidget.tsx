import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../../lib/me-api';
import { computeLifeStats, parseBirthday } from '../../lib/life-math';
import { useLifeColors } from '../../lib/life-colors';
import { fetchMilestones, milestoneQueryKeys } from '../../lib/milestones-api';
import type { Milestone } from '@focus-tracker/shared';
import { MilestoneMarker } from '../life/MilestoneMarker';
import { iconFor } from '../life/MilestonesSection';
import { useWidgetCollapsed } from './widget-collapse';
import { WidgetCollapseToggle } from './WidgetCollapseToggle';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — "Life strip" (MementoMori.md §8.1).
//
// Compact 52-cell strip showing just the current *year* row of the life
// calendar, plus a "Week N of M — X% lived" one-liner. Click → /life for
// the full grid.
//
// If the user hasn't set a birthday yet, the widget invites them to
// configure it rather than rendering an empty strip.

const BODY_ID = 'widget-life-strip-body';

export function LifeStripWidget() {
  const collapsed = useWidgetCollapsed('life_strip');

  const { data, isLoading } = useQuery({
    queryKey: meQueryKeys.profile(),
    queryFn: fetchMeProfile,
    // Skip fetching when the body is hidden — profile is also fetched by
    // Settings + /life so this just saves a redundant call when nothing
    // is visible.
    enabled: !collapsed,
    staleTime: 60_000,
  });

  const birthday = parseBirthday(data?.birthday);
  const stats = useMemo(() => {
    if (!birthday || !data) return null;
    return computeLifeStats(birthday, data.lifeExpectancyYears);
  }, [birthday, data]);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <header className={`flex items-baseline justify-between gap-3 ${collapsed ? '' : 'mb-3'}`}>
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-300">
            Life
          </h2>
          <WidgetReorderControls id="life_strip" />
          <WidgetCollapseToggle id="life_strip" controlsId={BODY_ID} />
          {stats && (
            <span className="text-xs text-neutral-500">
              Week {stats.currentWeekIndex.toLocaleString()} of{' '}
              {stats.totalWeeks.toLocaleString()} ·{' '}
              {stats.percentLived.toFixed(1)}% lived
            </span>
          )}
        </div>
        <Link
          to="/life"
          className="text-xs text-emerald-300/80 transition-colors hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open →
        </Link>
      </header>

      {!collapsed && (
        <div id={BODY_ID}>
          {isLoading ? (
            <p className="text-xs text-neutral-500">Loading…</p>
          ) : !stats ? (
            <NoBirthdayHint />
          ) : (
            <>
              <YearStrip stats={stats} />
              <ThisWeekReminders currentWeekIndex={stats.currentWeekIndex} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function NoBirthdayHint() {
  return (
    <div className="text-xs text-neutral-500">
      Set your birthday in{' '}
      <Link
        to="/settings"
        hash="profile"
        className="text-emerald-300 hover:underline"
      >
        Settings → Profile
      </Link>{' '}
      to see your life grid.
    </div>
  );
}

function YearStrip({
  stats,
}: {
  stats: ReturnType<typeof computeLifeStats>;
}) {
  const colors = useLifeColors();

  // Highlight the current year's row. Degenerate case: if the user set
  // a future birthday or a lifespan they've already exceeded, just show
  // the first or last row respectively.
  const safeWeek = Math.max(0, Math.min(stats.totalWeeks - 1, stats.currentWeekIndex));
  const yearIdx = Math.floor(safeWeek / 52);
  const colInYear = safeWeek % 52;
  const yearStart = yearIdx * 52;

  const cells: number[] = [];
  for (let c = 0; c < 52; c++) cells.push(yearStart + c);

  // Milestones are shared with /life and Settings; this query hits the
  // same cache key so there's no extra round-trip when any of those
  // pages has already loaded them.
  const { data: milestones } = useQuery({
    queryKey: milestoneQueryKeys.list(),
    queryFn: fetchMilestones,
    staleTime: 60_000,
  });
  const countsInYear = useMemo(() => {
    const m = new Map<number, number>();
    if (!milestones) return m;
    const yearEnd = yearStart + 52;
    for (const row of milestones) {
      if (row.weekIndex >= yearStart && row.weekIndex < yearEnd) {
        m.set(row.weekIndex, (m.get(row.weekIndex) ?? 0) + 1);
      }
    }
    return m;
  }, [milestones, yearStart]);

  return (
    <Link
      to="/life"
      aria-label={`Open life calendar — week ${stats.currentWeekIndex} of ${stats.totalWeeks}`}
      className="group block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
    >
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: 'repeat(52, 1fr)',
          gridAutoRows: '8px',
        }}
        aria-hidden="true"
      >
        {cells.map((idx) => {
          const col = idx - yearStart;
          const isCurrent = col === colInYear && idx === safeWeek;
          const isPast = idx < safeWeek;
          const bg = isCurrent
            ? colors.thisWeek
            : isPast
              ? colors.lived
              : colors.remaining;
          const count = countsInYear.get(idx) ?? 0;
          return (
            <div
              key={idx}
              className="relative rounded-[1px]"
              style={{ backgroundColor: bg }}
            >
              {count > 0 && <MilestoneMarker count={count} size={8} />}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[0.65rem] uppercase tracking-wide text-neutral-500">
        Year {yearIdx + 1} of {Math.floor(stats.totalWeeks / 52)}
      </p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
//  ThisWeekReminders — only renders when the current week has at least
//  one milestone. Shares the milestones query cache with YearStrip + the
//  /life grid + Settings → Memento Mori, so no extra round-trip.
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function ThisWeekReminders({ currentWeekIndex }: { currentWeekIndex: number }) {
  const { data } = useQuery({
    queryKey: milestoneQueryKeys.list(),
    queryFn: fetchMilestones,
    staleTime: 60_000,
  });
  const thisWeek = useMemo<Milestone[]>(
    () => (data ?? []).filter((m) => m.weekIndex === currentWeekIndex),
    [data, currentWeekIndex],
  );
  if (thisWeek.length === 0) return null;
  return (
    <section
      aria-label="Milestone reminders for this week"
      className="mt-3 border-t border-neutral-800 pt-3"
    >
      <h3 className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-400">
        Milestone reminders
      </h3>
      <ul className="flex flex-col gap-1">
        {thisWeek.map((m) => {
          const Icon = iconFor(m.icon);
          return (
            <li key={m.id} className="flex items-center gap-2 text-xs">
              <Icon size={14} style={{ color: m.color }} aria-hidden />
              <span className="flex-1 truncate text-neutral-200" title={m.label}>
                {m.label}
              </span>
              <span className="font-mono text-[0.65rem] text-neutral-500">
                {DATE_FMT.format(parseYmd(m.targetDate))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function parseYmd(s: string): Date {
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(y!, mo! - 1, d!);
}
