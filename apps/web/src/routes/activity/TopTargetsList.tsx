import type { ActivityTargetTotal } from '@focus-tracker/shared';
import { formatDuration } from '../../lib/format-duration';

// Top apps / top sites list. Spec (Activity.md §4.1) calls for top 5 on
// the page; the dashboard widget slices it down to 3. Render is a real
// `<ol>` so screen readers announce the rank.
//
// Visualises each row's share of the leader as a faint background bar so
// the eye can compare ratios at a glance — no chart library needed.

interface TopTargetsListProps {
  title: string;
  /// "apps" | "sites" — feeds the empty-state copy and the accent colour.
  kind: 'apps' | 'sites';
  items: ActivityTargetTotal[];
  /// Slice to the first `limit` rows (used by the dashboard widget).
  limit?: number;
}

export function TopTargetsList({ title, kind, items, limit }: TopTargetsListProps) {
  const shown = limit ? items.slice(0, limit) : items;
  const leader = shown[0]?.durationMs ?? 0;
  const accent = kind === 'apps' ? 'bg-emerald-500/15' : 'bg-sky-500/15';

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[0.7rem] uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
        <span className="text-[0.65rem] text-neutral-500">
          {kind === 'apps' ? 'desktop' : 'browser'}
        </span>
      </header>
      {shown.length === 0 ? (
        <p className="py-2 text-sm text-neutral-500">
          {kind === 'apps'
            ? 'No app data yet. Open the desktop app to start tracking.'
            : 'No site data yet. The browser extension will fill this in.'}
        </p>
      ) : (
        <ol className="space-y-1">
          {shown.map((row) => {
            const frac = leader === 0 ? 0 : row.durationMs / leader;
            return (
              <li
                key={row.target}
                className="relative flex items-center justify-between gap-3 overflow-hidden rounded px-2 py-1 text-sm"
              >
                <div
                  className={`absolute inset-y-0 left-0 ${accent}`}
                  style={{ width: `${frac * 100}%` }}
                  aria-hidden
                />
                <span className="relative truncate text-neutral-200" title={row.target}>
                  {row.target}
                </span>
                <span className="relative shrink-0 font-mono tabular-nums text-neutral-300">
                  {formatDuration(row.durationMs)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
