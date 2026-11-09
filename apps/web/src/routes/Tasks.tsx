import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SectionResponse,
  TaskInstanceResponse,
  TaskKind,
  TaskResponse,
} from '@focus-tracker/shared';
import {
  backlogQueryKeys,
  createSection,
  instancesQueryKeys,
  listBacklog,
  listSections,
  listTasks,
  listTodayInstances,
  sectionsQueryKeys,
  tasksQueryKeys,
} from '../lib/tasks-api';
import { BacklogRow } from './tasks/BacklogRow';
import { PRIORITY_SORT_INDEX } from './tasks/PriorityBadge';
import { PriorityColorPicker } from './tasks/PriorityColorPicker';
import { PriorityIconPicker } from './tasks/PriorityIconPicker';
import { RoutineRow } from './tasks/RoutineRow';
import { SectionBlock } from './tasks/SectionBlock';
import { TopOfTasksCharts } from './tasks/charts/TopOfTasksCharts';

// /tasks — Slice 1 view. Two kind panels (Dated + Ongoing), each
// grouped by Section with Inbox last. Routine + Backlog panels will
// land in Slice 2 and Slice 3 respectively.
//
// Data: one query per kind so we don't re-render Ongoing when a Dated
// task flips. Query keys share the `['tasks']` prefix so a server
// mutation invalidates both panels at once (see tasks-api.ts).

export function TasksPage() {
  const sectionsQuery = useQuery({
    queryKey: sectionsQueryKeys.list(),
    queryFn: listSections,
  });
  const datedQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'dated' }),
    queryFn: () => listTasks({ kind: 'dated' }),
  });
  const ongoingQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'ongoing' }),
    queryFn: () => listTasks({ kind: 'ongoing' }),
  });
  const routineQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'routine' }),
    queryFn: () => listTasks({ kind: 'routine' }),
  });
  // The /today endpoint lazy-materialises today's instances server-side,
  // so firing it alongside the routine list means by the time rows paint
  // their checkboxes are already bound to a real instance id.
  const todayInstancesQuery = useQuery({
    queryKey: instancesQueryKeys.today(),
    queryFn: listTodayInstances,
  });
  // Backlog panel appears below the kind panels only when non-empty
  // (Tasks.md §4.1). Shares its cache key with the AppShell nav badge
  // and the /backlog page, so there's no duplicate fetch.
  const backlogPanelQuery = useQuery({
    queryKey: backlogQueryKeys.list(),
    queryFn: () => listBacklog(),
  });

  const isLoading =
    sectionsQuery.isLoading ||
    datedQuery.isLoading ||
    ongoingQuery.isLoading ||
    routineQuery.isLoading ||
    todayInstancesQuery.isLoading;
  const isError =
    sectionsQuery.isError ||
    datedQuery.isError ||
    ongoingQuery.isError ||
    routineQuery.isError ||
    todayInstancesQuery.isError;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Tasks</h1>
          <p className="text-sm text-neutral-500">
            Routine, Dated, Ongoing &mdash; with consistency charts.
          </p>
        </div>
        <AddSectionButton />
      </header>

      {isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
      {isError && (
        <p className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          Couldn't load tasks. Check the API is reachable.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start xl:gap-6">
          <div className="order-2 flex min-w-0 flex-col gap-8 xl:order-none">
            <TopOfTasksCharts />
            <KindPanel
              title="Routine"
              kind="routine"
              tasks={routineQuery.data ?? []}
              sections={sectionsQuery.data ?? []}
              todayInstances={todayInstancesQuery.data ?? []}
            />
            <KindPanel
              title="Dated"
              kind="dated"
              tasks={datedQuery.data ?? []}
              sections={sectionsQuery.data ?? []}
            />
            <KindPanel
              title="Ongoing"
              kind="ongoing"
              tasks={ongoingQuery.data ?? []}
              sections={sectionsQuery.data ?? []}
            />
            {backlogPanelQuery.data && backlogPanelQuery.data.tasks.length > 0 && (
              <BacklogPanel tasks={backlogPanelQuery.data.tasks} />
            )}
          </div>
          <aside
            aria-label="Task color and icon settings"
            className="order-1 flex w-full flex-row flex-wrap items-start justify-end gap-2 xl:sticky xl:top-16 xl:w-auto xl:flex-col xl:justify-start xl:self-start"
          >
            <PriorityColorPicker />
            <PriorityIconPicker />
          </aside>
        </div>
      )}
    </main>
  );
}

interface KindPanelProps {
  title: string;
  kind: TaskKind;
  tasks: TaskResponse[];
  sections: SectionResponse[];
  /// Routine panel only — today's TaskInstance rows, joined client-side
  /// so each RoutineRow can bind its checkbox to the correct instance id.
  todayInstances?: TaskInstanceResponse[];
}

function KindPanel({
  title,
  kind,
  tasks,
  sections,
  todayInstances,
}: KindPanelProps) {
  // Group tasks by section id (null = Inbox) and sort each group by
  // priority DESC, then by createdAt ASC — matches the server default
  // but we re-sort client-side so late mutations (optimistic completion)
  // land in the right spot without a refetch flicker.
  const byGroup = useMemo(() => {
    const map = new Map<string | null, TaskResponse[]>();
    for (const t of tasks) {
      const key = t.sectionId;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const p = PRIORITY_SORT_INDEX[a.priority] - PRIORITY_SORT_INDEX[b.priority];
        if (p !== 0) return p;
        // Secondary: incomplete above complete (don't bury the active work).
        const ac = a.completedAt === null ? 0 : 1;
        const bc = b.completedAt === null ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return a.createdAt < b.createdAt ? -1 : 1;
      });
    }
    return map;
  }, [tasks]);

  // Routine-only: build a taskId → today's instance lookup. Memo keyed
  // on identity because the array ref changes on every refetch.
  const instancesByTaskId = useMemo(() => {
    const map = new Map<string, TaskInstanceResponse>();
    for (const i of todayInstances ?? []) map.set(i.taskId, i);
    return map;
  }, [todayInstances]);

  const renderRow =
    kind === 'routine'
      ? (task: TaskResponse) => (
          <RoutineRow
            task={task}
            todayInstance={instancesByTaskId.get(task.id) ?? null}
          />
        )
      : undefined;

  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2 border-b border-neutral-800 pb-1">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-200">
          {title}
        </h2>
        <span className="text-xs text-neutral-500">
          {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`}
        </span>
      </header>

      {sections.map((s) => (
        <SectionBlock
          key={s.id}
          section={s}
          tasks={byGroup.get(s.id) ?? []}
          kindForComposer={kind}
          renderRow={renderRow}
        />
      ))}
      {/* Inbox pseudo-section — always render so the composer is available
          even on a fresh account with no custom sections yet. */}
      <SectionBlock
        section={null}
        tasks={byGroup.get(null) ?? []}
        kindForComposer={kind}
        renderRow={renderRow}
      />
    </section>
  );
}

// Compact Backlog panel for /tasks (Tasks.md §4.1). Rendered only when
// at least one task is backlogged. Shows the top N rows inline and
// links to the full /backlog page for everything else.
function BacklogPanel({ tasks }: { tasks: TaskResponse[] }) {
  const INLINE_LIMIT = 10;
  const shown = tasks.slice(0, INLINE_LIMIT);
  const overflow = tasks.length - shown.length;
  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between gap-2 border-b border-neutral-800 pb-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-200">
            Backlog
          </h2>
          <span className="text-xs text-neutral-500">
            {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`}
          </span>
        </div>
        <Link
          to="/backlog"
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          Open backlog →
        </Link>
      </header>
      <ul className="flex flex-col gap-1">
        {shown.map((t) => (
          <BacklogRow key={t.id} task={t} />
        ))}
      </ul>
      {overflow > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          <Link to="/backlog" className="underline hover:text-neutral-300">
            +{overflow} more in /backlog
          </Link>
        </p>
      )}
    </section>
  );
}

function AddSectionButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const createMutation = useMutation({
    mutationFn: (n: string) => createSection({ name: n }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sectionsQueryKeys.all });
      setOpen(false);
      setName('');
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        + New section
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed) createMutation.mutate(trimmed);
      }}
      className="flex gap-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Section name"
        maxLength={60}
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
      />
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setName('');
        }}
        className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
      >
        Cancel
      </button>
    </form>
  );
}
