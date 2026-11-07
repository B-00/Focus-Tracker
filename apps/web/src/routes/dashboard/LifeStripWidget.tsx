import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../../lib/me-api';
import { computeLifeStats, parseBirthday } from '../../lib/life-math';
import { useLifeColors } from '../../lib/life-colors';
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
            <YearStrip stats={stats} />
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
          return (
            <div
              key={idx}
              className="rounded-[1px]"
              style={{ backgroundColor: bg }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[0.65rem] uppercase tracking-wide text-neutral-500">
        Year {yearIdx + 1} of {Math.floor(stats.totalWeeks / 52)}
      </p>
    </Link>
  );
}
