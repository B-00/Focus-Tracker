import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys } from '../../lib/me-api';
import { MilestonesSection } from '../life/MilestonesSection';

// /settings#memento-mori — Settings.md §4.2.
//
// Two blocks: a read-only inputs preview (birthday + life expectancy
// live in Profile) and the canonical milestones list. The milestone
// manager is literally the per-week MilestonesSection in all-milestones
// mode — one component, two surfaces, zero duplication.

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

export function MementoMoriSection() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: meQueryKeys.profile(),
    queryFn: fetchMeProfile,
  });

  const summary = useMemo(() => {
    if (!data?.birthday) return null;
    const birthday = parseYmd(data.birthday);
    if (!birthday) return null;
    const totalWeeks = data.lifeExpectancyYears * 52;
    const now = Date.now();
    const rawWeek = Math.floor((now - birthday.getTime()) / MS_PER_WEEK);
    const current = Math.max(0, Math.min(totalWeeks - 1, rawWeek));
    const pct = ((current / totalWeeks) * 100).toFixed(1);
    return {
      birthday: data.birthday,
      years: data.lifeExpectancyYears,
      current,
      totalWeeks,
      pct,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Memento Mori</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Milestones you want marked on your{' '}
          <a href="/life" className="text-emerald-300 hover:underline">
            life calendar
          </a>
          .
        </p>
      </header>

      {/* Inputs preview (Settings.md §4.2) */}
      <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-300">
        {isLoading ? (
          <span className="text-neutral-500">Loading profile…</span>
        ) : isError ? (
          <span className="text-red-300">
            Failed to load profile:{' '}
            {error instanceof Error ? error.message : 'unknown error'}
          </span>
        ) : !summary ? (
          <span>
            Set your birthday in{' '}
            <a href="#profile" className="text-emerald-300 hover:underline">
              Profile
            </a>{' '}
            to see your life calendar.
          </span>
        ) : (
          <span>
            Born: <span className="font-mono text-neutral-100">{summary.birthday}</span>
            {' · '}
            Life expectancy:{' '}
            <span className="font-mono text-neutral-100">{summary.years} years</span>
            {' · '}
            Week{' '}
            <span className="font-mono text-neutral-100">
              {(summary.current + 1).toLocaleString()}
            </span>{' '}
            of{' '}
            <span className="font-mono text-neutral-100">
              {summary.totalWeeks.toLocaleString()}
            </span>{' '}
            ({summary.pct}% lived)
            {' · '}
            <a href="#profile" className="text-emerald-300 hover:underline">
              Edit in Profile
            </a>
          </span>
        )}
      </div>

      {/* All-milestones mode — the Settings §4.2 canonical manager */}
      <MilestonesSection />
    </div>
  );
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}
