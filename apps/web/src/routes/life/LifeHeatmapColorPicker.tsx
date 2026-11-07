import {
  DEFAULT_LIFE_COLORS,
  setLifeColor,
  useLifeColors,
  type LifeColorRole,
} from '../../lib/life-colors';
import { LIFE_HEATMAP_LABELS, type HeatmapActiveTier } from '../../lib/life-heatmap';

// Horizontal 4-swatch heatmap color editor. Mirrors LifeColorPicker's
// pill-row shape so the three pickers (size / grid-colors / heatmap)
// read as a single consistent visual row in the header.
//
// Doubles as the activity legend — spec §4.2 wants a visual key near
// the grid, and this picker already shows each tier's color + hour range.
//
// Reset scope: resets ONLY h1..h4, leaving Lived / This week /
// Remaining alone. Mirrors the sibling picker's "my swatches" scope.

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
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-3 w-fit">
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

      <div
        className="flex gap-2"
        role="group"
        aria-label="Heatmap tier colors"
      >
        {ROWS.map(({ role, tier }) => {
          const label = LIFE_HEATMAP_LABELS[tier];
          return (
            <div
              key={role}
              className="flex flex-col items-center gap-1"
            >
              <span
                className="relative block h-5 w-5 rounded-sm border border-neutral-700 shadow-inner"
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
              <span className="whitespace-nowrap text-[0.6rem] text-neutral-400">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
