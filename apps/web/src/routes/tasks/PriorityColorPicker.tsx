import type { TaskPriority } from '@focus-tracker/shared';
import {
  DEFAULT_PRIORITY_COLORS,
  resetPriorityColors,
  setPriorityColor,
  usePriorityColors,
} from './priority-colors';

// Priority colour picker. Same responsive shape as the /life legends:
//   • < xl: horizontal row of (swatch over label) pills
//   • ≥ xl: vertical list of (swatch + label) rows for the sticky rail
//
// Changes propagate instantly via the usePriorityColors store, so every
// TaskRow and PriorityBadge on the page repaints as the user drags.

const ROWS: { priority: TaskPriority; label: string }[] = [
  { priority: 'extreme', label: 'Extreme' },
  { priority: 'high', label: 'High' },
  { priority: 'mid', label: 'Mid' },
  { priority: 'low', label: 'Low' },
];

export function PriorityColorPicker() {
  const colors = usePriorityColors();
  const isDirty = ROWS.some(
    ({ priority }) => colors[priority] !== DEFAULT_PRIORITY_COLORS[priority],
  );

  return (
    <section className="w-fit rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
          Priority colors
        </h2>
        {isDirty && (
          <button
            type="button"
            onClick={resetPriorityColors}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <ul
        className="flex flex-row gap-2 xl:flex-col xl:gap-1.5"
        role="group"
        aria-label="Task priority colors"
      >
        {ROWS.map(({ priority, label }) => (
          <li
            key={priority}
            className="flex w-16 flex-col items-center gap-1 xl:w-auto xl:flex-row xl:gap-2"
          >
            <span
              className="relative block h-5 w-5 shrink-0 rounded-sm border border-neutral-700 shadow-inner"
              style={{ backgroundColor: colors[priority] }}
              title={`Pick a color for ${label}`}
            >
              <input
                type="color"
                value={colors[priority]}
                onChange={(e) =>
                  setPriorityColor(priority, e.currentTarget.value)
                }
                className="absolute inset-0 h-full w-full cursor-pointer rounded-sm opacity-0"
                aria-label={`${label} priority color`}
              />
            </span>
            <span className="whitespace-nowrap text-xs text-neutral-400">
              {label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
