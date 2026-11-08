import {
  DEFAULT_LIFE_COLORS,
  setLifeColor,
  useLifeColors,
  type LifeColorRole,
} from '../../lib/life-colors';

// Life-grid cell-role colour picker. Two visual shapes via `xl:`
// responsive classes — HTML stays the same so the picker can live in
// either placement without re-mounting:
//   • < xl (tablet / smaller): horizontal row of (swatch over label)
//     pill-style items, matches the pre-sticky header shape.
//   • ≥ xl (desktop)        : vertical list of (swatch + label) rows,
//     fits the narrow sticky right rail on /life.
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

  const resetGrid = () => {
    for (const { role } of ROWS) {
      setLifeColor(role, DEFAULT_LIFE_COLORS[role]);
    }
  };

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-3 w-fit">
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
          Grid colors
        </h2>
        {isDirty && (
          <button
            type="button"
            onClick={resetGrid}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <ul
        // < xl: row of pills with fixed-width items so swatches align
        //       evenly regardless of label length (fixes the uneven-
        //       gap we hit before when labels varied in width).
        // ≥ xl: vertical rows (swatch left, label right).
        className="flex flex-row gap-2 xl:flex-col xl:gap-1.5"
        role="group"
        aria-label="Grid cell colors"
      >
        {ROWS.map(({ role, label, hint }) => (
          <li
            key={role}
            className="flex w-16 flex-col items-center gap-1 xl:w-auto xl:flex-row xl:gap-2"
          >
            <span
              className="relative block h-5 w-5 shrink-0 rounded-sm border border-neutral-700 shadow-inner"
              style={{ backgroundColor: colors[role] }}
              title={`${label} — ${hint}`}
            >
              <input
                type="color"
                value={colors[role]}
                onChange={(e) => setLifeColor(role, e.currentTarget.value)}
                className="absolute inset-0 h-full w-full cursor-pointer rounded-sm opacity-0"
                aria-label={`${label} color`}
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
