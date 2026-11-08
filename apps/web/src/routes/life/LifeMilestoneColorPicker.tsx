import {
  DEFAULT_LIFE_COLORS,
  setLifeColor,
  useLifeColors,
  type LifeColorRole,
} from '../../lib/life-colors';

// Milestone-count colour picker. Same responsive shape as Grid /
// Heatmap pickers — one HTML structure, two layouts via `xl:`:
//   • < xl: horizontal row of (swatch over label) pills
//   • ≥ xl: vertical list of (swatch + label) rows for the sticky rail
//
// Doubles as the milestone legend — the dots on the grid only encode
// count, so this is how the user learns "blue = 1, pink = 2, gold = 3+".
//
// Reset scope: m1..m3 only.

const ROWS: { role: Extract<LifeColorRole, `m${number}`>; label: string; hint: string }[] = [
  { role: 'm1', label: '1', hint: 'One milestone on a week' },
  { role: 'm2', label: '2', hint: 'Two milestones on a week' },
  { role: 'm3', label: '3+', hint: 'Three or more milestones on a week' },
];

export function LifeMilestoneColorPicker() {
  const colors = useLifeColors();
  const isDirty = ROWS.some(
    ({ role }) => colors[role] !== DEFAULT_LIFE_COLORS[role],
  );

  const resetMilestones = () => {
    for (const { role } of ROWS) {
      setLifeColor(role, DEFAULT_LIFE_COLORS[role]);
    }
  };

  return (
    <section className="w-fit rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
          Milestone colors
        </h2>
        {isDirty && (
          <button
            type="button"
            onClick={resetMilestones}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <ul
        className="flex flex-row gap-2 xl:flex-col xl:gap-1.5"
        role="group"
        aria-label="Milestone count colors"
      >
        {ROWS.map(({ role, label, hint }) => (
          <li
            key={role}
            className="flex w-14 flex-col items-center gap-1 xl:w-auto xl:flex-row xl:gap-2"
          >
            <span
              className="relative block h-5 w-5 shrink-0 rounded-full border border-neutral-700 shadow-inner"
              style={{ backgroundColor: colors[role] }}
              title={`${label} — ${hint}`}
            >
              <input
                type="color"
                value={colors[role]}
                onChange={(e) => setLifeColor(role, e.currentTarget.value)}
                className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
                aria-label={`${label} milestone color`}
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
