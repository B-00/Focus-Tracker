import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  BacklogGroupBy,
  SectionResponse,
  TaskPriority,
  TaskResponse,
} from '@focus-tracker/shared';
import { TASK_PRIORITIES } from '@focus-tracker/shared';
import {
  backlogQueryKeys,
  listBacklog,
  listSections,
  sectionsQueryKeys,
} from '../lib/tasks-api';
import { BacklogRow } from './tasks/BacklogRow';
import { PRIORITY_SORT_INDEX } from './tasks/PriorityBadge';

// /backlog — dedicated full-screen Backlog (Tasks.md §4.4).
//
// Shows every single-day dated task where `inBacklog = true`. Grouping
// toggle (priority | section) + a priority chip row filter. Chip row
// shows the *unfiltered* per-priority counts so the user can always
// see "what else is there to filter back in".
//
// Local UI state: group-by + filter are stored in localStorage so the
// toggle persists per-browser. Spec says the same toggle on the /tasks
// Backlog panel syncs with this — honoured via the shared key.

const STORAGE_KEY = 'ft:backlog-ui:v1';

type BacklogUiPrefs = {
  groupBy: BacklogGroupBy;
  priorityFilter: TaskPriority[]; // empty = no filter
};

function loadPrefs(): BacklogUiPrefs {
  if (typeof window === 'undefined') {
    return { groupBy: 'priority', priorityFilter: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { groupBy: 'priority', priorityFilter: [] };
    const parsed = JSON.parse(raw) as Partial<BacklogUiPrefs>;
    return {
      groupBy: parsed.groupBy ?? 'priority',
      priorityFilter: Array.isArray(parsed.priorityFilter)
        ? parsed.priorityFilter.filter((p): p is TaskPriority =>
            (TASK_PRIORITIES as readonly string[]).includes(p),
          )
        : [],
    };
  } catch {
    return { groupBy: 'priority', priorityFilter: [] };
  }
}

function savePrefs(prefs: BacklogUiPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage disabled — fail silent
  }
}

export function BacklogPage() {
  const [prefs, setPrefsState] = useState<BacklogUiPrefs>(() => loadPrefs());
  const setPrefs = (updater: (p: BacklogUiPrefs) => BacklogUiPrefs) => {
    setPrefsState((prev) => {
      const next = updater(prev);
      savePrefs(next);
      return next;
    });
  };

  const sectionsQuery = useQuery({
    queryKey: sectionsQueryKeys.list(),
    queryFn: listSections,
  });

  const backlogQuery = useQuery({
    queryKey: backlogQueryKeys.list({
      groupBy: prefs.groupBy,
      priority: prefs.priorityFilter.length > 0 ? prefs.priorityFilter : undefined,
    }),
    queryFn: () =>
      listBacklog({
        groupBy: prefs.groupBy,
        priority:
          prefs.priorityFilter.length > 0 ? prefs.priorityFilter : undefined,
      }),
  });

  const tasks = backlogQuery.data?.tasks ?? [];
  const summary = backlogQuery.data?.summary ?? { extreme: 0, high: 0, mid: 0, low: 0 };
  const totalUnfiltered = summary.extreme + summary.high + summary.mid + summary.low;

  function togglePriorityFilter(p: TaskPriority) {
    setPrefs((prev) => ({
      ...prev,
      priorityFilter: prev.priorityFilter.includes(p)
        ? prev.priorityFilter.filter((x) => x !== p)
        : [...prev.priorityFilter, p],
    }));
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-100">
              Backlog · {totalUnfiltered} task{totalUnfiltered === 1 ? '' : 's'}
            </h1>
            <p
              className="text-sm text-neutral-500"
              title="Tasks that were transferred forward and missed again — or missed without a transfer. Pull each one back to today or pick a date."
            >
              Tasks you missed. Pull them back to today or pick a date.
            </p>
          </div>
          <GroupByToggle
            groupBy={prefs.groupBy}
            onChange={(g) => setPrefs((prev) => ({ ...prev, groupBy: g }))}
          />
        </div>

        {/* Priority chip row — always shows unfiltered counts (§4.1). */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(['extreme', 'high', 'mid', 'low'] as const).map((p) => (
            <PriorityChip
              key={p}
              priority={p}
              count={summary[p]}
              active={prefs.priorityFilter.includes(p)}
              onClick={() => togglePriorityFilter(p)}
            />
          ))}
          {prefs.priorityFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, priorityFilter: [] }))}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              clear filter
            </button>
          )}
        </div>
      </header>

      {backlogQuery.isLoading && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
      {backlogQuery.isError && (
        <p className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          Couldn't load the backlog. Check the API is reachable.
        </p>
      )}

      {!backlogQuery.isLoading && !backlogQuery.isError && tasks.length === 0 && (
        <p className="rounded border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-500">
          {totalUnfiltered === 0
            ? 'Nothing in the backlog. 🎉'
            : 'No tasks match the current filter.'}
        </p>
      )}

      {!backlogQuery.isLoading && !backlogQuery.isError && tasks.length > 0 && (
        <BacklogGroups
          tasks={tasks}
          groupBy={prefs.groupBy}
          sections={sectionsQuery.data ?? []}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Group-by toggle
// ---------------------------------------------------------------------------

function GroupByToggle({
  groupBy,
  onChange,
}: {
  groupBy: BacklogGroupBy;
  onChange: (g: BacklogGroupBy) => void;
}) {
  return (
    <div className="inline-flex rounded border border-neutral-700 bg-neutral-900 text-xs">
      {(['priority', 'section'] as const).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          className={`px-2 py-1 transition-colors ${
            groupBy === g
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
          aria-pressed={groupBy === g}
        >
          {g === 'priority' ? 'By priority' : 'By section'}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Priority chip
// ---------------------------------------------------------------------------

function PriorityChip({
  priority,
  count,
  active,
  onClick,
}: {
  priority: TaskPriority;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  // Priority chip uses the badge's color vocabulary indirectly — we
  // import the shared label mapping from PriorityBadge via a helper.
  // Here we keep labels inline to avoid drilling the color map; tint
  // comes from PriorityBadge inside the rows below.
  const label = priority.charAt(0).toUpperCase() + priority.slice(1);
  const base =
    'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide transition-colors';
  const activeCss = active
    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
    : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${activeCss} ${count === 0 ? 'opacity-50' : ''}`}
    >
      <span>{label}</span>
      <span className="font-mono">{count}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Groups
// ---------------------------------------------------------------------------

function BacklogGroups({
  tasks,
  groupBy,
  sections,
}: {
  tasks: TaskResponse[];
  groupBy: BacklogGroupBy;
  sections: SectionResponse[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; tasks: TaskResponse[] }>();

    if (groupBy === 'priority') {
      // Fixed order: extreme → low.
      for (const p of ['extreme', 'high', 'mid', 'low'] as const) {
        map.set(p, {
          label: p.charAt(0).toUpperCase() + p.slice(1),
          tasks: [],
        });
      }
      for (const t of tasks) map.get(t.priority)?.tasks.push(t);
    } else {
      // By section. Sections in their configured order, Inbox last.
      const sectionsById = new Map(sections.map((s) => [s.id, s]));
      for (const t of tasks) {
        const key = t.sectionId ?? '__inbox__';
        const label = t.sectionId
          ? sectionsById.get(t.sectionId)?.name ?? 'Unknown section'
          : 'Inbox';
        if (!map.has(key)) map.set(key, { label, tasks: [] });
        map.get(key)!.tasks.push(t);
      }
    }

    // Secondary sort inside each group: priority desc, then original
    // due date asc. Matches /tasks default.
    for (const g of map.values()) {
      g.tasks.sort((a, b) => {
        const p = PRIORITY_SORT_INDEX[a.priority] - PRIORITY_SORT_INDEX[b.priority];
        if (p !== 0) return p;
        const ad = a.transferredFromDate ?? a.startDate ?? '';
        const bd = b.transferredFromDate ?? b.startDate ?? '';
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      });
    }

    // Drop empty priority groups so we don't render useless headers.
    return Array.from(map.entries()).filter(([, g]) => g.tasks.length > 0);
  }, [tasks, groupBy, sections]);

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([key, group]) => (
        <section key={key}>
          <header className="mb-1 flex items-baseline gap-2 border-b border-neutral-800 pb-1 px-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {group.label}
            </h2>
            <span className="text-[0.65rem] text-neutral-600">
              {group.tasks.length === 1 ? '1 task' : `${group.tasks.length} tasks`}
            </span>
          </header>
          <ul className="flex flex-col gap-1">
            {group.tasks.map((t) => (
              <BacklogRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
