import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TaskPriority } from '@focus-tracker/shared';
import { backlogQueryKeys, listBacklog } from '../../lib/tasks-api';
import { usePriorityColors } from '../tasks/priority-colors';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — "Backlog indicator" (Tasks.md §4.2 item 3 /
// Dashboard.md §3 `backlog`). Conditional render: hidden entirely when
// backlog is empty (no card chrome, no empty state) per Dashboard.md
// §4.1 — the backlog is a reminder, not a thing you want staring at
// you on a clean day.
//
// Layout: count pill + 4-segment priority-distribution stripe sized by
// per-priority count. Click anywhere → /backlog for the full view.
//
// Uses the same cache key the AppShell nav badge + /backlog page use —
// one fetch covers all three surfaces.

const PRIORITY_ORDER: TaskPriority[] = ['extreme', 'high', 'mid', 'low'];

export function BacklogIndicatorWidget() {
  const query = useQuery({
    queryKey: backlogQueryKeys.list(),
    queryFn: () => listBacklog(),
    staleTime: 30_000,
  });
  const colors = usePriorityColors();

  // Loading / error: silent. The nav badge already shows status; we
  // don't need a second noisy card.
  if (query.isLoading || query.isError || !query.data) return null;

  const { summary } = query.data;
  const total = summary.extreme + summary.high + summary.mid + summary.low;

  // Conditional render per spec — no empty state.
  if (total === 0) return null;

  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      {/* Header lives outside the Link wrapping the body so the reorder
          arrows aren't nested inside an <a> (invalid HTML + swallows
          clicks). The body + stripe below remain one big click target. */}
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-amber-300">
            Backlog
          </h2>
          <WidgetReorderControls id="backlog" />
          <span className="text-xs text-amber-400/80">
            {total} task{total === 1 ? '' : 's'} missed
          </span>
        </div>
        <Link
          to="/backlog"
          className="text-xs text-amber-300/80 transition-colors hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Open →
        </Link>
      </header>

      <Link
        to="/backlog"
        className="group block rounded transition-colors hover:bg-amber-500/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label={`Open backlog — ${total} task${total === 1 ? '' : 's'}`}
      >
        {/* 4-segment stripe. Each segment's width ∝ per-priority share;
            zero-count priorities collapse (no visible segment). Colors
            come from the user's palette so a palette tweak repaints
            here too. */}
        <div
          className="flex h-2 w-full overflow-hidden rounded bg-neutral-900"
          role="img"
          aria-label={
            `Backlog distribution — ` +
            PRIORITY_ORDER.map((p) => `${p}: ${summary[p]}`).join(', ')
          }
        >
          {PRIORITY_ORDER.map((p) => {
            const n = summary[p];
            if (n === 0) return null;
            return (
              <div
                key={p}
                style={{
                  width: `${(n / total) * 100}%`,
                  backgroundColor: colors[p],
                }}
                title={`${p}: ${n}`}
              />
            );
          })}
        </div>

        {/* Per-priority labels below the stripe, only for non-zero
            priorities. Keeps the widget self-explanatory without a
            separate legend. */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.65rem] uppercase tracking-wide text-amber-200/70">
          {PRIORITY_ORDER.map((p) => {
            const n = summary[p];
            if (n === 0) return null;
            return (
              <span key={p} className="inline-flex items-center gap-1">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: colors[p] }}
                  aria-hidden="true"
                />
                {p} {n}
              </span>
            );
          })}
        </div>
      </Link>
    </section>
  );
}
