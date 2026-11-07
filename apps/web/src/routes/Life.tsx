import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../lib/me-api';
import { computeLifeStats, parseBirthday } from '../lib/life-math';

// /life — Memento Mori life calendar (MementoMori.md §3.1).
//
// Slice 1: static skeleton grid. 52 columns × lifeExpectancyYears rows,
// current week highlighted, no telemetry shading, no drawer, no
// milestones. Later slices add the heatmap, session overlay, click-week
// drawer, and milestone markers.
//
// ponytail: grid is a plain CSS grid, not a canvas or virtualised list.
// Even 110 * 52 = 5,720 cells renders fine as DOM — we revisit only if
// it feels sluggish on the slowest supported device.

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
//  Onboarding — shown when birthday is missing. MementoMori.md §3.2 /
//  §9 Empty States.
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
//  Grid — skeleton only. Current week highlighted, past/future distinguished.
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

  const totalWeeks = stats.totalWeeks;
  // Clamp currentWeekIndex into [0, totalWeeks) so tests of "past" cells
  // don't accidentally shade the whole grid when a future birthday is set.
  const current = Math.max(0, Math.min(totalWeeks - 1, stats.currentWeekIndex));

  // Pre-build the cell array once per render. Even at 110*52 this is cheap.
  const cells = useMemo(() => {
    const out: { idx: number; year: number; col: number }[] = [];
    for (let idx = 0; idx < totalWeeks; idx++) {
      out.push({ idx, year: Math.floor(idx / 52), col: idx % 52 });
    }
    return out;
  }, [totalWeeks]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between gap-6 flex-wrap">
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
        <Legend />
      </header>

      <div className="overflow-x-auto">
        <div
          role="grid"
          aria-label={`Life calendar: ${totalWeeks} weeks`}
          className="grid gap-[2px]"
          style={{
            gridTemplateColumns: 'repeat(52, 10px)',
            gridAutoRows: '10px',
          }}
        >
          {cells.map(({ idx }) => {
            const isCurrent = idx === current;
            const isPast = idx < current;
            return (
              <div
                key={idx}
                role="gridcell"
                aria-label={`Week ${idx}${isCurrent ? ' (current)' : ''}`}
                title={`Week ${idx}`}
                className={
                  isCurrent
                    ? 'bg-emerald-400 ring-1 ring-emerald-200 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                    : isPast
                      ? 'bg-neutral-700'
                      : 'bg-neutral-900 border border-neutral-800'
                }
              />
            );
          })}
        </div>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Activity shading and session overlays land in later slices
        (MementoMori.md §3.4 / §3.5). Click-a-week notes and milestones too.
      </p>
    </main>
  );
}

function Legend() {
  return (
    <ul className="flex items-center gap-3 text-xs text-neutral-400" aria-label="Legend">
      <LegendSwatch className="bg-neutral-700" label="Lived" />
      <LegendSwatch className="bg-emerald-400" label="This week" />
      <LegendSwatch className="bg-neutral-900 border border-neutral-800" label="Remaining" />
    </ul>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} />
      <span>{label}</span>
    </li>
  );
}
