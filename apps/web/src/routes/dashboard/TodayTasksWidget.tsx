import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  TaskInstanceResponse,
  TaskPriority,
  TaskResponse,
} from '@focus-tracker/shared';
import {
  instancesQueryKeys,
  listTasks,
  listTodayInstances,
  tasksQueryKeys,
  toggleInstanceCompletion,
  toggleTaskCompletion,
} from '../../lib/tasks-api';
import { PRIORITY_SORT_INDEX, PriorityBadge } from '../tasks/PriorityBadge';
import { usePriorityColors, withAlpha } from '../tasks/priority-colors';

// Dashboard widget — "Today's Tasks" (Tasks.md §4.2 item 1 /
// Dashboard.md §3 `todays_tasks`). Compact, glance-first.
//
// Merges two sources in one list, priority-sorted:
//   * Dated tasks where today ∈ [startDate, endDate] AND not backlogged.
//   * Today's routine instances (one per routine scheduled today).
//
// Checkbox plumbing differs by row type — dated toggles the Task's
// completedAt, routine toggles the TaskInstance's. Both mutations hit
// the same cache keys as /tasks, so a tick here repaints /tasks too.
//
// ponytail: "today" is computed with the browser's local date. For a
// single-user app the browser's tz matches the server's tz the vast
// majority of the time; if they ever disagree (e.g. laptop just crossed
// a tz boundary), this widget might show yesterday/tomorrow's dated
// tasks for a few minutes. Upgrade path: add a GET /v1/tasks/today
// endpoint that resolves today server-side and returns the merged list.

const MAX_ROWS = 8;

export function TodayTasksWidget() {
  const today = todayYmd();

  // Shares cache keys with /tasks (same query keys). Dated + routine
  // task lists + today's instances — three cheap reads, all deduped.
  const datedQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'dated' }),
    queryFn: () => listTasks({ kind: 'dated' }),
  });
  const routineQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'routine' }),
    queryFn: () => listTasks({ kind: 'routine' }),
  });
  const todayInstancesQuery = useQuery({
    queryKey: instancesQueryKeys.today(),
    queryFn: listTodayInstances,
  });

  const rows = useMemo(() => {
    const out: Row[] = [];
    // Dated rows: today's date must be in [startDate, endDate]. Also
    // skip anything in backlog — those belong on /backlog, not here.
    for (const t of datedQuery.data ?? []) {
      if (t.inBacklog) continue;
      if (!t.startDate) continue;
      const start = t.startDate;
      const end = t.endDate ?? start;
      if (today < start || today > end) continue;
      out.push({ kind: 'dated', task: t });
    }
    // Routine rows: one per instance (server already filtered to
    // today's scheduled ones). Need the parent task for the title.
    const routinesById = new Map<string, TaskResponse>();
    for (const r of routineQuery.data ?? []) routinesById.set(r.id, r);
    for (const i of todayInstancesQuery.data ?? []) {
      const parent = routinesById.get(i.taskId);
      if (!parent) continue; // orphan instance — shouldn't happen
      out.push({ kind: 'routine', task: parent, instance: i });
    }
    // Priority desc, then incomplete above complete.
    out.sort((a, b) => {
      const p = PRIORITY_SORT_INDEX[a.task.priority] - PRIORITY_SORT_INDEX[b.task.priority];
      if (p !== 0) return p;
      const ac = rowCompleted(a) ? 1 : 0;
      const bc = rowCompleted(b) ? 1 : 0;
      return ac - bc;
    });
    return out;
  }, [today, datedQuery.data, routineQuery.data, todayInstancesQuery.data]);

  const isLoading =
    datedQuery.isLoading || routineQuery.isLoading || todayInstancesQuery.isLoading;
  const isError =
    datedQuery.isError || routineQuery.isError || todayInstancesQuery.isError;

  const shown = rows.slice(0, MAX_ROWS);
  const overflow = rows.length - shown.length;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Today's tasks
        </h2>
        <Link
          to="/tasks"
          className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open tasks →
        </Link>
      </header>

      {isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
      {isError && (
        <p className="text-sm text-red-300">Couldn't load today's tasks.</p>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing scheduled for today. Add a task on{' '}
          <Link to="/tasks" className="text-neutral-300 underline">
            /tasks
          </Link>
          .
        </p>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-1">
            {shown.map((row) => (
              <TaskRowCompact key={rowKey(row)} row={row} />
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

// ---------------------------------------------------------------------------
//  Row model + compact row component
// ---------------------------------------------------------------------------

type Row =
  | { kind: 'dated'; task: TaskResponse }
  | { kind: 'routine'; task: TaskResponse; instance: TaskInstanceResponse };

function rowCompleted(row: Row): boolean {
  if (row.kind === 'dated') return row.task.completedAt !== null;
  return row.instance.completedAt !== null;
}

function rowKey(row: Row): string {
  return row.kind === 'dated' ? `d:${row.task.id}` : `r:${row.instance.id}`;
}

function TaskRowCompact({ row }: { row: Row }) {
  const qc = useQueryClient();
  const colors = usePriorityColors();
  const priority: TaskPriority = row.task.priority;
  const completed = rowCompleted(row);

  const toggleMutation = useMutation({
    mutationFn: () =>
      row.kind === 'dated'
        ? toggleTaskCompletion(row.task.id, row.task.completedAt === null)
        : toggleInstanceCompletion(row.instance.id, row.instance.completedAt === null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      void qc.invalidateQueries({ queryKey: instancesQueryKeys.all });
    },
  });

  return (
    <li
      className={`flex items-center gap-2 rounded px-2 py-1 transition-colors ${completed ? 'opacity-50' : ''}`}
      style={{ backgroundColor: withAlpha(colors[priority], 0.1) }}
    >
      <PriorityBadge priority={priority} variant="glyph" />
      <input
        type="checkbox"
        checked={completed}
        onChange={() => toggleMutation.mutate()}
        disabled={toggleMutation.isPending}
        className="h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
        aria-label={`Mark "${row.task.title}" ${completed ? 'incomplete' : 'complete'}`}
      />
      <span
        className={`flex-1 truncate text-sm ${completed ? 'line-through text-neutral-500' : 'text-neutral-100'}`}
        title={row.task.title}
      >
        {row.task.title}
      </span>
      {row.kind === 'routine' && (
        <span
          className="shrink-0 text-[0.6rem] text-neutral-500"
          title="Routine task — completion applies to today only"
          aria-label="routine"
        >
          ↻
        </span>
      )}
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
