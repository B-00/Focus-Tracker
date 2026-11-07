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
import { useWidgetCollapsed } from './widget-collapse';
import { WidgetCollapseToggle } from './WidgetCollapseToggle';
import { WidgetDragHandle } from './SortableWidget';

// Dashboard widget — "Today's Tasks". Compact list of dated tasks where
// today ∈ [startDate, endDate] AND not backlogged. Routines live in
// their own TodayRoutinesWidget — they have a different mental model
// (habit vs due-date) and bucketing separately reads cleaner.
//
// ponytail: "today" uses the browser's local date. For a single-user
// app the browser's tz == server's tz the vast majority of the time;
// if they diverge (laptop just crossed a tz boundary), this might
// show yesterday/tomorrow's dated tasks for a few minutes. Upgrade
// path: GET /v1/tasks/today endpoint.

const MAX_ROWS = 8;

const BODY_ID = 'widget-today-tasks-body';

export function TodayTasksWidget() {
  const today = todayYmd();
  const collapsed = useWidgetCollapsed('today_tasks');

  const query = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'dated' }),
    queryFn: () => listTasks({ kind: 'dated' }),
    // No point polling the list when the widget is folded up.
    enabled: !collapsed,
  });

  const rows = useMemo(() => {
    const out: TaskResponse[] = [];
    for (const t of query.data ?? []) {
      if (t.inBacklog) continue;
      if (!t.startDate) continue;
      const end = t.endDate ?? t.startDate;
      if (today < t.startDate || today > end) continue;
      out.push(t);
    }
    out.sort((a, b) => {
      const p = PRIORITY_SORT_INDEX[a.priority] - PRIORITY_SORT_INDEX[b.priority];
      if (p !== 0) return p;
      const ac = a.completedAt === null ? 0 : 1;
      const bc = b.completedAt === null ? 0 : 1;
      return ac - bc;
    });
    return out;
  }, [today, query.data]);

  const shown = rows.slice(0, MAX_ROWS);
  const overflow = rows.length - shown.length;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className={`flex items-baseline justify-between gap-3 ${collapsed ? '' : 'mb-3'}`}>
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Today's tasks
          </h2>
          <WidgetDragHandle />
          <WidgetCollapseToggle id="today_tasks" controlsId={BODY_ID} />
        </div>
        <Link
          to="/tasks"
          className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open tasks →
        </Link>
      </header>

      {!collapsed && (
        <div id={BODY_ID}>
          {query.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-red-300">Couldn't load today's tasks.</p>
          )}

          {!query.isLoading && !query.isError && rows.length === 0 && (
            <p className="text-sm text-neutral-500">
              Nothing dated for today. Add a task on{' '}
              <Link to="/tasks" className="text-neutral-300 underline">
                /tasks
              </Link>
              .
            </p>
          )}

          {!query.isLoading && !query.isError && rows.length > 0 && (
            <>
              <ul className="flex flex-col gap-1">
                {shown.map((task) => (
                  <DatedRowCompact key={task.id} task={task} />
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
        </div>
      )}
    </section>
  );
}

function DatedRowCompact({ task }: { task: TaskResponse }) {
  const qc = useQueryClient();
  const colors = usePriorityColors();
  const completed = task.completedAt !== null;

  const toggleMutation = useMutation({
    mutationFn: () => toggleTaskCompletion(task.id, task.completedAt === null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
    },
  });

  return (
    <li
      className={`flex items-center gap-2 rounded px-2 py-1 transition-colors ${completed ? 'opacity-50' : ''}`}
      style={{ backgroundColor: withAlpha(colors[task.priority], 0.1) }}
    >
      <PriorityBadge priority={task.priority} variant="glyph" />
      <input
        type="checkbox"
        checked={completed}
        onChange={() => toggleMutation.mutate()}
        disabled={toggleMutation.isPending}
        className="h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
        aria-label={`Mark "${task.title}" ${completed ? 'incomplete' : 'complete'}`}
      />
      <span
        className={`flex-1 truncate text-sm ${completed ? 'line-through text-neutral-500' : 'text-neutral-100'}`}
        title={task.title}
      >
        {task.title}
      </span>
    </li>
  );
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
