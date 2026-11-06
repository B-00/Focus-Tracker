import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TaskResponse } from '@focus-tracker/shared';
import {
  listTasks,
  tasksQueryKeys,
  toggleTaskCompletion,
} from '../../lib/tasks-api';
import { PRIORITY_SORT_INDEX, PriorityBadge } from '../tasks/PriorityBadge';
import { usePriorityColors, withAlpha } from '../tasks/priority-colors';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — "Ongoing Tasks" (Tasks.md §4.2 item 2 /
// Dashboard.md §3 `ongoing_tasks`). Compact list of incomplete ongoing
// tasks, priority desc. Completed ones are filtered out — the dashboard
// is "what's on my plate", not "what did I just do".
//
// Reuses the existing tasksQueryKeys.list({kind:'ongoing'}) key so
// having /tasks open doesn't double-fetch.

const MAX_ROWS = 6;

export function OngoingTasksWidget() {
  const query = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'ongoing' }),
    queryFn: () => listTasks({ kind: 'ongoing' }),
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    return all
      .filter((t) => t.completedAt === null)
      .sort((a, b) => {
        const p = PRIORITY_SORT_INDEX[a.priority] - PRIORITY_SORT_INDEX[b.priority];
        if (p !== 0) return p;
        return a.createdAt < b.createdAt ? -1 : 1;
      });
  }, [query.data]);

  const shown = rows.slice(0, MAX_ROWS);
  const overflow = rows.length - shown.length;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Ongoing tasks
          </h2>
          <WidgetReorderControls id="ongoing_tasks" />
        </div>
        <Link
          to="/tasks"
          className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open tasks →
        </Link>
      </header>

      {query.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
      {query.isError && (
        <p className="text-sm text-red-300">Couldn't load ongoing tasks.</p>
      )}

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="text-sm text-neutral-500">
          No ongoing tasks. Add one on{' '}
          <Link to="/tasks" className="text-neutral-300 underline">
            /tasks
          </Link>
          .
        </p>
      )}

      {!query.isLoading && !query.isError && rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-1">
            {shown.map((t) => (
              <OngoingRowCompact key={t.id} task={t} />
            ))}
          </ul>
          {overflow > 0 && (
            <p className="mt-2 text-xs text-neutral-500">
              <Link to="/tasks" className="hover:text-neutral-300">
                +{overflow} more →
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function OngoingRowCompact({ task }: { task: TaskResponse }) {
  const qc = useQueryClient();
  const colors = usePriorityColors();

  const toggleMutation = useMutation({
    mutationFn: () => toggleTaskCompletion(task.id, task.completedAt === null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
    },
  });

  return (
    <li
      className="flex items-center gap-2 rounded px-2 py-1 transition-colors"
      style={{ backgroundColor: withAlpha(colors[task.priority], 0.1) }}
    >
      <PriorityBadge priority={task.priority} variant="glyph" />
      <input
        type="checkbox"
        checked={false}
        onChange={() => toggleMutation.mutate()}
        disabled={toggleMutation.isPending}
        className="h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
        aria-label={`Mark "${task.title}" complete`}
      />
      <span
        className="flex-1 truncate text-sm text-neutral-100"
        title={task.title}
      >
        {task.title}
      </span>
    </li>
  );
}
