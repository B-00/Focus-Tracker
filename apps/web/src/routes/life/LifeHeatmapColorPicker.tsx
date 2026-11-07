import {
  DEFAULT_LIFE_COLORS,
  setLifeColor,
  useLifeColors,
  type LifeColorRole,
} from '../../lib/life-colors';
import { LIFE_HEATMAP_LABELS, type HeatmapActiveTier } from '../../lib/life-heatmap';

// 4-row heatmap color editor for the life grid. Mirrors
// LifeColorPicker's shape 1:1 so the two pickers read as a pair.
//
// Doubles as the activity legend — spec §4.2 calls for a visual key
// near the grid, and this picker already shows each tier's color +
// hour range + hex. Separate legend strip removed.
//
// "Reset" scope: resets ONLY the four heatmap roles (h1..h4), leaving
// Lived / This week / Remaining alone. Mirrors the sibling picker's
// "reset my swatches" scope, not a global palette reset.

const ROWS: { role: Extract<LifeColorRole, `h${number}`>; tier: HeatmapActiveTier }[] = [
  { role: 'h1', tier: 1 },
  { role: 'h2', tier: 2 },
  { role: 'h3', tier: 3 },
  { role: 'h4', tier: 4 },
];

export function LifeHeatmapColorPicker() {
  const colors = useLifeColors();
  const isDirty = ROWS.some(
    ({ role }) => colors[role] !== DEFAULT_LIFE_COLORS[role],
  );

  const resetHeatmap = () => {
    for (const { role } of ROWS) {
      setLifeColor(role, DEFAULT_LIFE_COLORS[role]);
    }
  };

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-3 w-56">
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
          Heatmap colors
        </h2>
        {isDirty && (
          <button
            type="button"
            onClick={resetHeatmap}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <ul className="flex flex-col gap-1.5">
        {ROWS.map(({ role, tier }) => {
          const label = LIFE_HEATMAP_LABELS[tier];
          return (
            <li
              key={role}
              className="flex items-center gap-2 text-xs text-neutral-200"
            >
              <span
                className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-neutral-700 shadow-inner"
                style={{ backgroundColor: colors[role] }}
                title={`Pick a color for the ${label} activity tier`}
              >
                <input
                  type="color"
                  value={colors[role]}
                  onChange={(e) => setLifeColor(role, e.currentTarget.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer rounded-sm opacity-0"
                  aria-label={`${label} tier color`}
                />
              </span>
              <span className="flex-1">{label}</span>
              <span className="font-mono text-[0.65rem] uppercase text-neutral-500">
                {colors[role]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
