import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TaskInstanceResponse,
  TaskResponse,
} from '@focus-tracker/shared';
import {
  deleteTask,
  instancesQueryKeys,
  tasksQueryKeys,
  toggleInstanceCompletion,
} from '../../lib/tasks-api';
import { PriorityBadge } from './PriorityBadge';
import { usePriorityColors, withAlpha } from './priority-colors';

// One row in the Routine panel. If today's instance exists (i.e. the
// routine is scheduled for today AND in-window), the checkbox toggles
// its completedAt via the instance endpoint. If it doesn't exist, we
// show a muted "not today" dash — the user can still edit / delete
// the parent routine, but there's no completion affordance.
//
// Deliberate split from TaskRow: completion plumbing is different
// (TaskInstance id, not Task id), the "not today" state has no analog
// in dated / ongoing rows, and the cadence pill is routine-only.

interface RoutineRowProps {
  task: TaskResponse;
  /// Today's instance for this routine, or null if the routine isn't
  /// scheduled for today / not in its active window.
  todayInstance: TaskInstanceResponse | null;
}

export function RoutineRow({ task, todayInstance }: RoutineRowProps) {
  const qc = useQueryClient();
  const colors = usePriorityColors();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: () => {
      if (!todayInstance) throw new Error('no instance for today');
      return toggleInstanceCompletion(
        todayInstance.id,
        todayInstance.completedAt === null,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: instancesQueryKeys.all });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      void qc.invalidateQueries({ queryKey: instancesQueryKeys.all });
    },
  });

  const scheduledToday = todayInstance !== null;
  const completed = todayInstance?.completedAt !== null && todayInstance != null;

  return (
    <li
      className={`group flex items-center gap-3 rounded border border-transparent px-2 py-1.5 transition-colors hover:border-neutral-800 ${
        completed ? 'opacity-50' : ''
      }`}
      style={{ backgroundColor: withAlpha(colors[task.priority], 0.1) }}
    >
      <PriorityBadge priority={task.priority} variant="glyph" />

      {scheduledToday ? (
        <input
          type="checkbox"
          checked={completed}
          onChange={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className="h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
          aria-label={`Mark "${task.title}" ${completed ? 'incomplete' : 'complete'} for today`}
        />
      ) : (
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-neutral-700"
          title="Not scheduled for today"
          aria-hidden="true"
        >
          —
        </span>
      )}

      <span
        className={`flex-1 text-sm ${completed ? 'line-through text-neutral-500' : 'text-neutral-100'}`}
      >
        {task.title}
      </span>

      <CadencePill days={task.routineDaysOfWeek} />

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/20"
              title="Deleting also deletes any TaskInstance history for this routine"
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
            title="Delete routine"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

/// "Mon/Wed/Fri" compact pill. Shortcuts to "Daily" / "Weekdays" /
/// "Weekends" when the pattern matches — matches the composer's
/// preset vocabulary so the UI reads consistently.
export function formatCadence(days: number[]): string {
  if (days.length === 0) return '—';
  const sorted = days.slice().sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '1,2,3,4,5,6,7') return 'Daily';
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '6,7') return 'Weekends';
  // Mon=1 .. Sun=7
  const map = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return sorted.map((d) => map[d]).join('/');
}

function CadencePill({ days }: { days: number[] }) {
  return (
    <span className="shrink-0 rounded bg-neutral-800/60 px-1.5 py-0.5 text-[0.65rem] text-neutral-400">
      {formatCadence(days)}
    </span>
  );
}
