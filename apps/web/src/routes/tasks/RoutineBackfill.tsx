import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTINE_BACKFILL_DAYS, type TaskResponse } from '@focus-tracker/shared';
import { chartsQueryKeys } from '../../lib/charts-api';
import {
  instancesQueryKeys,
  listInstancesForDay,
  toggleInstanceCompletion,
} from '../../lib/tasks-api';

// "Forgot to tick it" — pick one of the last N days and fix that day's
// routine check-ins. The server re-scores the day so the consistency
// chart picks it up on the next fetch.

const FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function pastDays(): { ymd: string; label: string }[] {
  const out = [];
  for (let i = 1; i <= ROUTINE_BACKFILL_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ ymd, label: i === 1 ? `Yesterday (${FMT.format(d)})` : FMT.format(d) });
  }
  return out;
}

export function RoutineBackfill({ routines }: { routines: TaskResponse[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const days = pastDays();
  const [day, setDay] = useState(days[0]!.ymd);

  const query = useQuery({
    queryKey: [...instancesQueryKeys.all, 'day', day],
    queryFn: () => listInstancesForDay(day),
    enabled: open,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => toggleInstanceCompletion(v.id, v.done),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: instancesQueryKeys.all });
      void qc.invalidateQueries({ queryKey: chartsQueryKeys.all });
    },
  });

  const titles = new Map(routines.map((r) => [r.id, r.title]));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-2 text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
      >
        Missed a check-in?
      </button>
    );
  }

  return (
    <div className="mb-3 rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
        <span>Fix check-ins for</span>
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-100"
        >
          {days.map((d) => (
            <option key={d.ymd} value={d.ymd}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto rounded px-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          Done
        </button>
      </div>
      {query.isLoading && <p className="text-xs text-neutral-500">Loading…</p>}
      {query.data && query.data.length === 0 && (
        <p className="text-xs text-neutral-500">No routines were scheduled that day.</p>
      )}
      <ul className="flex flex-col gap-1">
        {query.data?.map((i) => {
          const done = i.completedAt !== null;
          return (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={done}
                disabled={toggle.isPending}
                onChange={() => toggle.mutate({ id: i.id, done: !done })}
                className="h-4 w-4 accent-emerald-500"
                aria-label={`Mark "${titles.get(i.taskId) ?? 'routine'}" ${done ? 'missed' : 'done'}`}
              />
              <span className={done ? 'text-neutral-400 line-through' : 'text-neutral-100'}>
                {titles.get(i.taskId) ?? '(archived routine)'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
