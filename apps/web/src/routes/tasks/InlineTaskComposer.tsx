import type { ReactNode } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaskRequest,
  TaskKind,
  TaskPriority,
} from '@focus-tracker/shared';
import { TASK_PRIORITIES } from '@focus-tracker/shared';
import { createTask, tasksQueryKeys } from '../../lib/tasks-api';

// Inline add-task form shown at the bottom of each SectionBlock + Inbox.
//
// Behavior per Tasks.md §4.1:
//   - Kind picker drives which fields appear (dated: date inputs,
//     ongoing: just title).
//   - Priority picker is ALWAYS visible and REQUIRED — the submit
//     button is disabled until priority is picked. No default.
//   - For "dated" with a single-day date (endDate blank or =startDate),
//     a "Transfer to next day if missed" checkbox appears.
//   - Routine kind is in the picker but shows a "coming in Slice 2"
//     note so the surface is stable without lying about readiness.

interface InlineTaskComposerProps {
  /// `null` = Inbox (no section).
  sectionId: string | null;
  /// Pre-select a kind so the dashboard "Add dated" shortcut can skip
  /// the picker. Default: 'dated' (most-used).
  defaultKind?: TaskKind;
}

// ISO weekday labels. 1 = Mon ... 7 = Sun — matches Prisma's `Int[]`
// storage format for `routineDaysOfWeek`.
const WEEKDAY_LABELS: { iso: number; short: string }[] = [
  { iso: 1, short: 'M' },
  { iso: 2, short: 'T' },
  { iso: 3, short: 'W' },
  { iso: 4, short: 'T' },
  { iso: 5, short: 'F' },
  { iso: 6, short: 'S' },
  { iso: 7, short: 'S' },
];

export function InlineTaskComposer({
  sectionId,
  defaultKind = 'dated',
}: InlineTaskComposerProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TaskKind>(defaultKind);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [startDate, setStartDate] = useState(() => todayYmd());
  const [endDate, setEndDate] = useState('');
  const [transferIfMissed, setTransferIfMissed] = useState(false);
  const [routineDays, setRoutineDays] = useState<number[]>([1, 2, 3, 4, 5]); // Weekdays default

  const createMutation = useMutation({
    mutationFn: (body: CreateTaskRequest) => createTask(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      // Close + reset to clean defaults so the next "+ Add task" click
      // opens a fresh form rather than one with stale state.
      setOpen(false);
      setTitle('');
      setPriority('');
      setStartDate(todayYmd());
      setEndDate('');
      setTransferIfMissed(false);
      setRoutineDays([1, 2, 3, 4, 5]);
    },
  });

  function toggleRoutineDay(iso: number) {
    setRoutineDays((prev) =>
      prev.includes(iso)
        ? prev.filter((d) => d !== iso)
        : [...prev, iso].sort((a, b) => a - b),
    );
  }

  function submit(): void {
    if (!title.trim() || priority === '') return;
    if (kind === 'routine' && routineDays.length === 0) return;
    const base = {
      priority: priority as TaskPriority,
      title: title.trim(),
      sectionId,
    };
    if (kind === 'dated') {
      createMutation.mutate({
        kind: 'dated',
        startDate,
        endDate: endDate === '' ? null : endDate,
        transferIfMissed:
          transferIfMissed && (endDate === '' || endDate === startDate),
        ...base,
      });
    } else if (kind === 'routine') {
      createMutation.mutate({
        kind: 'routine',
        routineDaysOfWeek: routineDays,
        ...base,
      });
    } else {
      createMutation.mutate({ kind: 'ongoing', ...base });
    }
  }

  const canSubmit =
    title.trim().length > 0 &&
    priority !== '' &&
    (kind !== 'routine' || routineDays.length > 0);
  const isSingleDay = kind === 'dated' && (endDate === '' || endDate === startDate);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-2 my-1 rounded border border-dashed border-neutral-800 px-3 py-1.5 text-left text-xs text-neutral-500 hover:border-neutral-700 hover:text-neutral-400"
      >
        + Add task
      </button>
    );
  }

  return (
    <form
      className="mx-2 my-2 flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900/40 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as TaskKind)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
          aria-label="Task kind"
        >
          <option value="dated">Dated</option>
          <option value="ongoing">Ongoing</option>
          <option value="routine">Routine</option>
        </select>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          maxLength={200}
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
      </div>

      {kind === 'dated' && (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <label className="flex items-center gap-1">
            Start
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
            />
          </label>
          <label className="flex items-center gap-1">
            End
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
            />
          </label>
          {isSingleDay && (
            <label className="ml-auto flex items-center gap-1">
              <input
                type="checkbox"
                checked={transferIfMissed}
                onChange={(e) => setTransferIfMissed(e.target.checked)}
                className="h-3 w-3 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
              />
              <span>Transfer if missed</span>
            </label>
          )}
        </div>
      )}

      {kind === 'routine' && (
        <div className="flex flex-col gap-1.5 text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[0.65rem] uppercase tracking-wide">
              Days
            </span>
            <div className="flex gap-1">
              {WEEKDAY_LABELS.map((d) => {
                const on = routineDays.includes(d.iso);
                return (
                  <button
                    type="button"
                    key={d.iso}
                    onClick={() => toggleRoutineDay(d.iso)}
                    aria-pressed={on}
                    className={`h-6 w-6 rounded border text-[0.7rem] font-medium transition-colors ${
                      on
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                        : 'border-neutral-700 bg-neutral-900 text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0" />
            <div className="flex gap-1 text-[0.65rem]">
              <PresetButton onClick={() => setRoutineDays([1, 2, 3, 4, 5, 6, 7])}>
                Daily
              </PresetButton>
              <PresetButton onClick={() => setRoutineDays([1, 2, 3, 4, 5])}>
                Weekdays
              </PresetButton>
              <PresetButton onClick={() => setRoutineDays([6, 7])}>
                Weekends
              </PresetButton>
            </div>
          </div>
          {routineDays.length === 0 && (
            <p className="text-[0.65rem] text-amber-300">
              Pick at least one day.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority | '')}
          required
          aria-label="Priority (required)"
          className={`rounded border px-2 py-1 text-xs ${
            priority === ''
              ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
              : 'border-neutral-700 bg-neutral-900 text-neutral-200'
          }`}
        >
          <option value="" disabled>
            Priority…
          </option>
          {TASK_PRIORITIES.slice().reverse().map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!canSubmit || createMutation.isPending}
          className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle('');
            setPriority('');
          }}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>

        {createMutation.isError && (
          <span className="ml-2 text-xs text-red-400">
            {(createMutation.error as Error).message}
          </span>
        )}
      </div>
    </form>
  );
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function PresetButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
    >
      {children}
    </button>
  );
}
