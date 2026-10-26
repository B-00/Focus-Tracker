import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskResponse } from '@focus-tracker/shared';
import {
  deleteTask,
  tasksQueryKeys,
  toggleTaskCompletion,
} from '../../lib/tasks-api';
import { PriorityBadge } from './PriorityBadge';

// One row in a Dated / Ongoing panel. Checkbox → toggles completion with
// optimistic UI. Trash icon → confirm-then-delete (hard, no trash).
//
// Keeps mutation plumbing colocated so the TaskRow is drop-in anywhere
// (panel, dashboard widget, backlog) without extra wiring.

interface TaskRowProps {
  task: TaskResponse;
  /// Hide the date pill (Dated panel always shows it; dashboard variants
  /// might skip when "today" is implied).
  showDate?: boolean;
}

export function TaskRow({ task, showDate = true }: TaskRowProps) {
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: () => toggleTaskCompletion(task.id, task.completedAt === null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
    },
  });

  const completed = task.completedAt !== null;

  return (
    <li
      className={`group flex items-center gap-3 rounded border border-transparent px-2 py-1.5 hover:border-neutral-800 hover:bg-neutral-900/40 ${
        completed ? 'opacity-50' : ''
      }`}
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
        className={`flex-1 text-sm ${completed ? 'line-through text-neutral-500' : 'text-neutral-100'}`}
      >
        {task.title}
      </span>

      {showDate && task.kind === 'dated' && task.startDate && (
        <DatePill
          startDate={task.startDate}
          endDate={task.endDate}
          transferIfMissed={task.transferIfMissed}
        />
      )}

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/20"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            aria-label={`Delete "${task.title}"`}
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

function DatePill({
  startDate,
  endDate,
  transferIfMissed,
}: {
  startDate: string;
  endDate: string | null;
  transferIfMissed: boolean;
}) {
  const text =
    endDate && endDate !== startDate
      ? `${formatYmd(startDate)} → ${formatYmd(endDate)}`
      : formatYmd(startDate);
  return (
    <span
      className="shrink-0 rounded bg-neutral-800/60 px-1.5 py-0.5 text-[0.65rem] text-neutral-400"
      title={transferIfMissed ? 'Will roll forward if missed' : undefined}
    >
      {text}
      {transferIfMissed && <span className="ml-1 text-emerald-400">↻</span>}
    </span>
  );
}

/// Short format for the date pill — strip the year if the date is in the
/// current year (common case), keep it otherwise. "2026-10-26" → "Oct 26";
/// "2027-01-04" (next year) → "Jan 4, 2027".
function formatYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
