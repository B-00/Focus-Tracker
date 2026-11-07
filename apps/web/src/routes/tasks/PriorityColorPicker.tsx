import type { TaskPriority } from '@focus-tracker/shared';
import {
  DEFAULT_PRIORITY_COLORS,
  resetPriorityColors,
  setPriorityColor,
  usePriorityColors,
} from './priority-colors';

// Lightweight palette editor rendered under the task panels. One row
// per priority: swatch (native <input type="color">) + label + current
// hex. Changes propagate instantly via the usePriorityColors store, so
// every TaskRow and PriorityBadge on the page repaints the moment the
// user drops the picker.
//
// ponytail: native color input is good enough. Browser-provided,
// keyboard-accessible, zero dependency weight. Upgrade path if ever
// needed: swap the <input> for a custom popover palette.

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
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-200">
            Change Task Color
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Click a swatch to pick a color — every task of that priority updates instantly.
          </p>
        </div>
        {isDirty && (
          <button
            type="button"
            onClick={resetPriorityColors}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <ul className="flex flex-col gap-2">
        {ROWS.map(({ priority, label }) => (
          <li
            key={priority}
            className="flex items-center gap-3 text-sm text-neutral-200"
          >
            {/* The visible circle is the <input> itself with opacity 0,
                overlaid on a styled background span. Clicking anywhere
                in the circle opens the native picker. */}
            <span
              className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-700 shadow-inner"
              style={{ backgroundColor: colors[priority] }}
              title={`Pick a color for ${label}`}
            >
              <input
                type="color"
                value={colors[priority]}
                onChange={(e) =>
                  setPriorityColor(priority, e.currentTarget.value)
                }
                className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
                aria-label={`${label} priority color`}
              />
            </span>
            <span className="flex-1">{label}</span>
            <span className="font-mono text-xs uppercase text-neutral-500">
              {colors[priority]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
