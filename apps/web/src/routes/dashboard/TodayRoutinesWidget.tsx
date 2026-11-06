import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  TaskInstanceResponse,
  TaskResponse,
} from '@focus-tracker/shared';
import {
  instancesQueryKeys,
  listTasks,
  listTodayInstances,
  tasksQueryKeys,
  toggleInstanceCompletion,
} from '../../lib/tasks-api';
import { PRIORITY_SORT_INDEX, PriorityBadge } from '../tasks/PriorityBadge';
import { usePriorityColors, withAlpha } from '../tasks/priority-colors';
import { useWidgetCollapsed } from './widget-collapse';
import { WidgetCollapseToggle } from './WidgetCollapseToggle';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — "Today's Routines". Mirrors TodayTasksWidget but
// scoped to today's routine instances only. Split from the merged
// list so dated/routine stay visually distinct — dated is "finite,
// due-date-driven work" and routine is "repeated habit", and bucketing
// them separately reads cleaner on a glance.
//
// Server-side lazy materialisation (InstancesService.listToday) means
// "today's routines" is driven by actual DB rows — no client-side
// weekday math needed here.

const MAX_ROWS = 8;
const BODY_ID = 'widget-today-routines-body';

export function TodayRoutinesWidget() {
  const collapsed = useWidgetCollapsed('today_routines');
  const routineQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'routine' }),
    queryFn: () => listTasks({ kind: 'routine' }),
    enabled: !collapsed,
  });
  const todayInstancesQuery = useQuery({
    queryKey: instancesQueryKeys.today(),
    queryFn: listTodayInstances,
    enabled: !collapsed,
  });

  const rows = useMemo(() => {
    const parents = new Map<string, TaskResponse>();
    for (const r of routineQuery.data ?? []) parents.set(r.id, r);

    const out: { task: TaskResponse; instance: TaskInstanceResponse }[] = [];
    for (const i of todayInstancesQuery.data ?? []) {
      const task = parents.get(i.taskId);
      if (!task) continue;
      out.push({ task, instance: i });
    }
    // Priority desc, incomplete before complete.
    out.sort((a, b) => {
      const p =
        PRIORITY_SORT_INDEX[a.task.priority] - PRIORITY_SORT_INDEX[b.task.priority];
      if (p !== 0) return p;
      const ac = a.instance.completedAt === null ? 0 : 1;
      const bc = b.instance.completedAt === null ? 0 : 1;
      return ac - bc;
    });
    return out;
  }, [routineQuery.data, todayInstancesQuery.data]);

  const isLoading = routineQuery.isLoading || todayInstancesQuery.isLoading;
  const isError = routineQuery.isError || todayInstancesQuery.isError;

  const shown = rows.slice(0, MAX_ROWS);
  const overflow = rows.length - shown.length;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className={`flex items-baseline justify-between gap-3 ${collapsed ? '' : 'mb-3'}`}>
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Today's routines
          </h2>
          <WidgetReorderControls id="today_routines" />
          <WidgetCollapseToggle id="today_routines" controlsId={BODY_ID} />
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
          {isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-300">Couldn't load today's routines.</p>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <p className="text-sm text-neutral-500">
              No routines scheduled for today.
            </p>
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <>
              <ul className="flex flex-col gap-1">
                {shown.map(({ task, instance }) => (
                  <RoutineRowCompact key={instance.id} task={task} instance={instance} />
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

function RoutineRowCompact({
  task,
  instance,
}: {
  task: TaskResponse;
  instance: TaskInstanceResponse;
}) {
  const qc = useQueryClient();
  const colors = usePriorityColors();
  const completed = instance.completedAt !== null;

  const toggleMutation = useMutation({
    mutationFn: () =>
      toggleInstanceCompletion(instance.id, instance.completedAt === null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: instancesQueryKeys.all });
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
        aria-label={`Mark "${task.title}" ${completed ? 'incomplete' : 'complete'} for today`}
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
