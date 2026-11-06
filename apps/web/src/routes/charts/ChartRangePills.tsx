import type { ChartRangePill } from '../../lib/charts-api';

// Small pill row for the time-series range selector (TaskCharts.md §4.2).
// Same visual regardless of chart family, so the user builds a single
// muscle memory for "1M vs 3M" picking.

interface Props {
  value: ChartRangePill;
  onChange: (next: ChartRangePill) => void;
  options: readonly ChartRangePill[];
}

export function ChartRangePills({ value, onChange, options }: Props) {
  return (
    <div
      role="group"
      aria-label="Chart range"
      className="inline-flex gap-1 text-[0.65rem] uppercase tracking-wider"
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            className={
              'rounded px-2 py-0.5 transition-colors ' +
              (active
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300')
            }
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
