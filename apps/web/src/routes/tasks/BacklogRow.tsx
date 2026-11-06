import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskResponse } from '@focus-tracker/shared';
import {
  backlogQueryKeys,
  deleteTask,
  redateTask,
  sectionsQueryKeys,
  tasksQueryKeys,
  toggleTaskCompletion,
} from '../../lib/tasks-api';
import { PriorityBadge } from './PriorityBadge';
import { usePriorityColors, withAlpha } from './priority-colors';

// Backlog list row (Tasks.md §4.4). Shares the visual grammar of
// TaskRow — priority tint, glyph, title, hover-reveal actions — but
// adds the thing TaskRow doesn't need: a "Redate" control. Two paths:
//
//   1. [Send to today] → POST /v1/tasks/:id/redate { date: "today" }
//   2. Date picker → POST /v1/tasks/:id/redate { date: "YYYY-MM-DD" }
//
// Also shows the task's `transferredFromDate` (if the row got here via
// a one-day transfer), so the user can tell "this was Monday" at a
// glance. A row without transferredFromDate came straight to backlog
// (transferIfMissed was false, or a future tweak) and shows its
// `startDate` as the original due date.

interface BacklogRowProps {
  task: TaskResponse;
}

export function BacklogRow({ task }: BacklogRowProps) {
  const qc = useQueryClient();
  const colors = usePriorityColors();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState(() => todayYmd());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Invalidate both backlog and tasks after a redate — the row moves
  // from the backlog surface to the Dated panel on /tasks.
  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: backlogQueryKeys.all });
    void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
    void qc.invalidateQueries({ queryKey: sectionsQueryKeys.all });
  };

  const redateMutation = useMutation({
    mutationFn: (date: string | 'today') => redateTask(task.id, { date }),
    onSuccess: () => {
      invalidateAll();
      setPickerOpen(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () => toggleTaskCompletion(task.id, task.completedAt === null),
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: invalidateAll,
  });

  const originalDue = task.transferredFromDate ?? task.startDate;

  return (
    <li
      className="group flex flex-col gap-2 rounded border border-transparent px-2 py-1.5 transition-colors hover:border-neutral-800"
      style={{ backgroundColor: withAlpha(colors[task.priority], 0.1) }}
    >
      <div className="flex items-center gap-3">
        <PriorityBadge priority={task.priority} variant="glyph" />

        {/* Direct-complete escape hatch per §3.5: a backlogged task
            can be completed without redating. */}
        <input
          type="checkbox"
          checked={false}
          onChange={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className="h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
          aria-label={`Mark "${task.title}" complete`}
          title="Mark complete (stays in history, leaves backlog)"
        />

        <span className="flex-1 text-sm text-neutral-100">{task.title}</span>

        {originalDue && (
          <span
            className="shrink-0 rounded bg-neutral-800/60 px-1.5 py-0.5 text-[0.65rem] text-neutral-400"
            title={
              task.transferredFromDate
                ? 'Originally due this day (transferred once, then missed)'
                : 'Was scheduled for this day'
            }
          >
            {formatYmd(originalDue)}
          </span>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => redateMutation.mutate('today')}
            disabled={redateMutation.isPending}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
            title="Reschedule for today"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[0.7rem] text-neutral-300 hover:bg-neutral-800"
            title="Pick a date"
            aria-expanded={pickerOpen}
          >
            Pick…
          </button>
          {confirmingDelete ? (
            <>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[0.7rem] text-red-300 hover:bg-red-500/20"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[0.7rem] text-neutral-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded px-1.5 py-0.5 text-xs text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-800 hover:text-neutral-300 group-hover:opacity-100"
              aria-label={`Delete "${task.title}"`}
              title="Delete"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {pickerOpen && (
        <form
          className="flex items-center gap-2 pl-7 text-xs text-neutral-400"
          onSubmit={(e) => {
            e.preventDefault();
            if (pickedDate) redateMutation.mutate(pickedDate);
          }}
        >
          <label className="flex items-center gap-1">
            Send to
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
            />
          </label>
          <button
            type="submit"
            disabled={!pickedDate || redateMutation.isPending}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          {redateMutation.isError && (
            <span className="text-red-400">
              {(redateMutation.error as Error).message}
            </span>
          )}
        </form>
      )}
    </li>
  );
}

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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
