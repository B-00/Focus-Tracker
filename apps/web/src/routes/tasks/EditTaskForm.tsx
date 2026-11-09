import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskPriority, TaskResponse, UpdateTaskRequest } from '@focus-tracker/shared';
import { TASK_PRIORITIES } from '@focus-tracker/shared';
import {
  instancesQueryKeys,
  listSections,
  sectionsQueryKeys,
  tasksQueryKeys,
  updateTask,
} from '../../lib/tasks-api';

// Inline editor for an existing task on /tasks. Mirrors the create
// composer field set (kind is immutable, so no kind picker). Used by
// TaskRow (dated/ongoing) and RoutineRow.

const WEEKDAY_LABELS: { iso: number; short: string }[] = [
  { iso: 1, short: 'M' },
  { iso: 2, short: 'T' },
  { iso: 3, short: 'W' },
  { iso: 4, short: 'T' },
  { iso: 5, short: 'F' },
  { iso: 6, short: 'S' },
  { iso: 7, short: 'S' },
];

interface Props {
  task: TaskResponse;
  onCancel: () => void;
  onSaved: () => void;
}

export function EditTaskForm({ task, onCancel, onSaved }: Props) {
  const qc = useQueryClient();
  const sectionsQuery = useQuery({
    queryKey: sectionsQueryKeys.list(),
    queryFn: listSections,
  });

  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [sectionId, setSectionId] = useState<string>(task.sectionId ?? '');
  const [startDate, setStartDate] = useState(task.startDate ?? '');
  const [endDate, setEndDate] = useState(task.endDate ?? '');
  const [transferIfMissed, setTransferIfMissed] = useState(task.transferIfMissed);
  const [routineDays, setRoutineDays] = useState<number[]>(
    task.routineDaysOfWeek.slice().sort((a, b) => a - b),
  );

  const updateMutation = useMutation({
    mutationFn: (body: UpdateTaskRequest) => updateTask(task.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      void qc.invalidateQueries({ queryKey: instancesQueryKeys.all });
      onSaved();
    },
    onError: (err: unknown) => {
      const status =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 404) {
        void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
        onSaved();
      }
    },
  });

  const trimmed = title.trim();
  const isSingleDay =
    task.kind === 'dated' && (endDate === '' || endDate === startDate);
  const canSave =
    trimmed.length > 0 &&
    !updateMutation.isPending &&
    (task.kind !== 'routine' || routineDays.length > 0) &&
    (task.kind !== 'dated' || startDate.length > 0);

  function toggleRoutineDay(iso: number) {
    setRoutineDays((prev) =>
      prev.includes(iso)
        ? prev.filter((d) => d !== iso)
        : [...prev, iso].sort((a, b) => a - b),
    );
  }

  function save(): void {
    if (!canSave) return;
    const body: UpdateTaskRequest = {};
    if (trimmed !== task.title) body.title = trimmed;
    if (priority !== task.priority) body.priority = priority;
    const nextSectionId = sectionId === '' ? null : sectionId;
    if (nextSectionId !== task.sectionId) body.sectionId = nextSectionId;

    if (task.kind === 'dated') {
      if (startDate && startDate !== task.startDate) body.startDate = startDate;
      const nextEnd = endDate && endDate !== startDate ? endDate : null;
      if (nextEnd !== task.endDate) body.endDate = nextEnd;
      const nextTransfer = isSingleDay ? transferIfMissed : false;
      if (nextTransfer !== task.transferIfMissed) body.transferIfMissed = nextTransfer;
    }

    if (task.kind === 'routine') {
      const current = task.routineDaysOfWeek.slice().sort((a, b) => a - b);
      if (current.join(',') !== routineDays.join(',')) {
        body.routineDaysOfWeek = routineDays;
      }
    }

    if (Object.keys(body).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(body);
  }

  return (
    <form
      className="flex w-full flex-col gap-2 rounded border border-neutral-700 bg-neutral-900/60 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        aria-label="Task title"
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-emerald-500/50 focus:outline-none"
      />

      <div className="flex gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          aria-label="Priority"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
        >
          {TASK_PRIORITIES.slice()
            .reverse()
            .map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
        </select>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          aria-label="Section"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
        >
          <option value="">Inbox</option>
          {(sectionsQuery.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {task.kind === 'dated' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
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
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
            />
          </label>
          <label
            className={`ml-auto flex items-center gap-1 ${
              isSingleDay ? '' : 'cursor-not-allowed opacity-40'
            }`}
            title={
              isSingleDay
                ? 'Roll this task to the next day if it is still incomplete at midnight'
                : 'Transfer if missed is only valid on single-day tasks — clear End to enable'
            }
          >
            <input
              type="checkbox"
              checked={isSingleDay && transferIfMissed}
              disabled={!isSingleDay}
              onChange={(e) => setTransferIfMissed(e.target.checked)}
              className="h-3 w-3 rounded border-neutral-600 bg-neutral-900 accent-emerald-500 disabled:cursor-not-allowed"
            />
            <span>Transfer if missed</span>
          </label>
        </div>
      )}

      {task.kind === 'routine' && (
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
            <p className="text-[0.65rem] text-amber-300">Pick at least one day.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={updateMutation.isPending}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>
        {updateMutation.isError && (
          <span className="text-xs text-red-400">
            {(updateMutation.error as Error).message}
          </span>
        )}
      </div>
    </form>
  );
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
