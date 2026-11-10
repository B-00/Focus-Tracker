import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palmtree } from 'lucide-react';
import type { Vacation } from '@focus-tracker/shared';
import { chartsQueryKeys } from '../lib/charts-api';
import {
  createVacation,
  deleteVacation,
  listVacations,
  vacationsQueryKeys,
} from '../lib/tasks-api';
import { Modal } from './Modal';

// Gold "Vacation" button + dialog. Same component on Dashboard, Life,
// Calendar, Tasks and Settings. Days inside a range are skipped by the
// nightly scorer, so dated + routine tasks then don't count either way.

const FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function localYmd(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

function label(ymd: string): string {
  return FMT.format(new Date(`${ymd}T00:00:00`));
}

export function VacationButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = localYmd();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const query = useQuery({ queryKey: vacationsQueryKeys.all, queryFn: listVacations });
  const vacations = query.data ?? [];
  const active = vacations.find((v) => v.startDate <= today && today <= v.endDate);

  const onChanged = () => {
    void qc.invalidateQueries({ queryKey: vacationsQueryKeys.all });
    void qc.invalidateQueries({ queryKey: chartsQueryKeys.all });
  };
  const addMutation = useMutation({
    mutationFn: () => createVacation({ startDate: start, endDate: end }),
    onSuccess: onChanged,
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteVacation(id),
    onSuccess: onChanged,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-400/70 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
          active ? 'bg-amber-400/10' : ''
        }`}
      >
        <Palmtree size={14} aria-hidden />
        {active ? `On vacation · until ${label(active.endDate)}` : 'Vacation'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Vacation mode"
        description="Dated and routine tasks due on these days won't count for or against your consistency."
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addMutation.mutate();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            From
            <input
              type="date"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 [color-scheme:dark]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            To
            <input
              type="date"
              required
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 [color-scheme:dark]"
            />
          </label>
          <button
            type="submit"
            disabled={addMutation.isPending || !start || end < start}
            className="rounded border border-amber-400/70 bg-amber-400/10 px-3 py-1 text-sm text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
          >
            {addMutation.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
        {addMutation.isError && (
          <p className="mt-2 text-xs text-red-300">Couldn't add that range (max 1 year).</p>
        )}

        <ul className="mt-4 flex flex-col gap-1">
          {vacations.length === 0 && (
            <li className="text-sm text-neutral-500">No vacations yet.</li>
          )}
          {vacations.map((v: Vacation) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded border border-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
            >
              <span>
                {label(v.startDate)}
                {v.endDate !== v.startDate && ` – ${label(v.endDate)}`}
                {v === active && <span className="ml-2 text-xs text-amber-300">now</span>}
              </span>
              <button
                type="button"
                onClick={() => removeMutation.mutate(v.id)}
                disabled={removeMutation.isPending}
                className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
                aria-label={`Remove vacation starting ${label(v.startDate)}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
