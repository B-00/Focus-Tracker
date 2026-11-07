import {
  DEFAULT_LIFE_COLORS,
  resetLifeColors,
  setLifeColor,
  useLifeColors,
  type LifeColorRole,
} from '../../lib/life-colors';

// Compact three-row color editor for the life grid. Mirrors
// PriorityColorPicker's shape: swatch (native <input type="color">) +
// label + current hex. Picks propagate instantly via useLifeColors so
// the main grid repaints as the user drags the picker.
//
// ponytail: native color input, same reasoning as the priority picker.

const ROWS: { role: LifeColorRole; label: string; hint: string }[] = [
  { role: 'lived', label: 'Lived', hint: 'Weeks already past' },
  { role: 'thisWeek', label: 'This week', hint: 'The current-week cell' },
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

      <ul className="flex flex-col gap-1.5">
        {ROWS.map(({ role, label, hint }) => (
          <li
            key={role}
            className="flex items-center gap-2 text-xs text-neutral-200"
          >
            <span
              className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-neutral-700 shadow-inner"
              style={{ backgroundColor: colors[role] }}
              title={`Pick a color for ${label} — ${hint}`}
            >
              <input
                type="color"
                value={colors[role]}
                onChange={(e) => setLifeColor(role, e.currentTarget.value)}
                className="absolute inset-0 h-full w-full cursor-pointer rounded-sm opacity-0"
                aria-label={`${label} color`}
              />
            </span>
            <span className="flex-1">{label}</span>
            <span className="font-mono text-[0.65rem] uppercase text-neutral-500">
              {colors[role]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
