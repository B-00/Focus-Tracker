import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SectionResponse,
  TaskKind,
  TaskResponse,
} from '@focus-tracker/shared';
import {
  createSection,
  listSections,
  listTasks,
  sectionsQueryKeys,
  tasksQueryKeys,
} from '../lib/tasks-api';
import { PRIORITY_SORT_INDEX } from './tasks/PriorityBadge';
import { PriorityColorPicker } from './tasks/PriorityColorPicker';
import { SectionBlock } from './tasks/SectionBlock';

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

  const isLoading =
    sectionsQuery.isLoading || datedQuery.isLoading || ongoingQuery.isLoading;
  const isError =
    sectionsQuery.isError || datedQuery.isError || ongoingQuery.isError;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Tasks</h1>
          <p className="text-sm text-neutral-500">
            Dated + Ongoing. Routine panel and consistency charts land in later slices.
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
        <div className="flex flex-col gap-8">
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
          <PriorityColorPicker />
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
}

function KindPanel({ title, kind, tasks, sections }: KindPanelProps) {
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
        />
      ))}
      {/* Inbox pseudo-section — always render so the composer is available
          even on a fresh account with no custom sections yet. */}
      <SectionBlock
        section={null}
        tasks={byGroup.get(null) ?? []}
        kindForComposer={kind}
      />
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
