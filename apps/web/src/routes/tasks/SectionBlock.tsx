import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SectionResponse, TaskKind, TaskResponse } from '@focus-tracker/shared';
import {
  deleteSection,
  sectionsQueryKeys,
  tasksQueryKeys,
  updateSection,
} from '../../lib/tasks-api';
import { InlineTaskComposer } from './InlineTaskComposer';
import { TaskRow } from './TaskRow';

// Section-grouped block within a panel. Header carries the section
// name + color + inline rename, body shows task rows, footer carries
// the add-task composer.
//
// Inbox (section=null) uses the same block without the edit controls —
// it's a built-in bucket, not a user-owned Section.

interface SectionBlockProps {
  /// `null` → Inbox pseudo-section.
  section: SectionResponse | null;
  tasks: TaskResponse[];
  kindForComposer: TaskKind;
  /// Hide the composer entirely (e.g. for Backlog which uses a
  /// different add flow). Default: visible.
  hideComposer?: boolean;
  /// Custom row renderer. Default renders a `TaskRow`. Routines
  /// override this to render `RoutineRow` (which needs today's
  /// instance joined in — a dependency SectionBlock doesn't know
  /// about by design).
  renderRow?: (task: TaskResponse) => ReactNode;
}

export function SectionBlock({
  section,
  tasks,
  kindForComposer,
  hideComposer = false,
  renderRow,
}: SectionBlockProps) {
  const qc = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(section?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState<'inbox' | 'cascade' | null>(null);

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      updateSection(section!.id, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sectionsQueryKeys.all });
      setRenameOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (mode: 'inbox' | 'cascade') => deleteSection(section!.id, mode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sectionsQueryKeys.all });
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      setConfirmDelete(null);
    },
  });

  return (
    <section className="mb-3">
      {/* Header */}
      <div className="group mb-1 flex items-center gap-2 px-2">
        {section && (
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: section.color }}
            aria-hidden="true"
          />
        )}
        {renameOpen && section ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = renameValue.trim();
              if (trimmed && trimmed !== section.name) renameMutation.mutate(trimmed);
              else setRenameOpen(false);
            }}
            className="flex flex-1 gap-1"
          >
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => setRenameOpen(false)}
              className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-100"
            />
          </form>
        ) : (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {section ? section.name : 'Inbox'}
            </h3>
            <span className="text-[0.65rem] text-neutral-600">
              {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`}
            </span>
            {section && (
              <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(section.name);
                    setRenameOpen(true);
                  }}
                  className="rounded px-1.5 py-0.5 text-[0.65rem] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                  title="Rename section"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete('inbox')}
                  className="rounded px-1.5 py-0.5 text-[0.65rem] text-neutral-500 hover:bg-neutral-800 hover:text-red-300"
                  title="Delete section"
                >
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete-mode picker — Tasks.md §5.3 requires explicit choice */}
      {confirmDelete && section && (
        <div className="mx-2 mb-2 rounded border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-200">
          <p className="mb-2">
            Delete <strong>{section.name}</strong>? Choose what happens to its{' '}
            {tasks.length} task{tasks.length === 1 ? '' : 's'}:
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => deleteMutation.mutate('inbox')}
              disabled={deleteMutation.isPending}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200 hover:bg-neutral-800"
            >
              Move tasks to Inbox
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate('cascade')}
              disabled={deleteMutation.isPending}
              className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-red-300 hover:bg-red-500/20"
            >
              Delete tasks too
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="ml-auto rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rows */}
      {tasks.length > 0 ? (
        <ul className="flex flex-col">
          {tasks.map((t) =>
            renderRow ? (
              <Fragment key={t.id}>{renderRow(t)}</Fragment>
            ) : (
              <TaskRow key={t.id} task={t} />
            ),
          )}
        </ul>
      ) : (
        <p className="px-3 py-1 text-[0.7rem] italic text-neutral-600">
          No tasks here yet.
        </p>
      )}

      {!hideComposer && (
        <InlineTaskComposer
          sectionId={section?.id ?? null}
          defaultKind={kindForComposer}
        />
      )}
    </section>
  );
}
