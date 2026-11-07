import {
  DEFAULT_LIFE_COLORS,
  resetLifeColors,
  setLifeColor,
  useLifeColors,
  type LifeColorRole,
} from '../../lib/life-colors';

// Horizontal 3-swatch color editor for the life grid. Matches the pill-
// row shape of LifeSizePicker so size + grid-colors + heatmap-colors
// read as a single visual row in the header.
//
// Reset button still sits next to the title; scope is "grid roles only"
// (lived / thisWeek / remaining) — the heatmap picker owns its own
// reset for h1..h4.
//
// ponytail: still native <input type="color"> so dragging the swatch
// propagates instantly via useLifeColors and the CSS-var fast path
// repaints cells without re-rendering React.

const ROWS: { role: LifeColorRole; label: string; hint: string }[] = [
  { role: 'lived',     label: 'Lived',     hint: 'Weeks already past' },
  { role: 'thisWeek',  label: 'This week', hint: 'The current-week cell' },
  { role: 'remaining', label: 'Remaining', hint: 'Weeks still to come' },
];

export function LifeColorPicker() {
  const colors = useLifeColors();
  const isDirty = ROWS.some(
    ({ role }) => colors[role] !== DEFAULT_LIFE_COLORS[role],
  );

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-3 w-56">
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
          Grid colors
        </h2>
        {isDirty && (
          <button
            type="button"
            onClick={resetLifeColors}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <div
        className="flex gap-1"
        role="group"
        aria-label="Grid cell colors"
      >
        {ROWS.map(({ role, label, hint }) => (
          <div
            key={role}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <span
              className="relative block h-7 w-full rounded border border-neutral-700 shadow-inner"
              style={{ backgroundColor: colors[role] }}
              title={`${label} — ${hint}`}
            >
              <input
                type="color"
                value={colors[role]}
                onChange={(e) => setLifeColor(role, e.currentTarget.value)}
                className="absolute inset-0 h-full w-full cursor-pointer rounded opacity-0"
                aria-label={`${label} color`}
              />
            </span>
            <span className="whitespace-nowrap text-[0.6rem] text-neutral-400">
              {label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
