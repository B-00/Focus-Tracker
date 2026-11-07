import {
  LIFE_SIZE_PRESETS,
  setLifeSize,
  useLifeSize,
  type LifeSize,
} from '../../lib/life-size';

// Pill group — four size tiers for the life grid. One-click switching;
// the pick persists via useLifeSize's store + localStorage. Each tier
// updates CSS variables on <main> rather than React props so cells
// don't re-render on resize (same perf trick as colors).

const SIZES: { id: LifeSize; label: string }[] = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
];

export function LifeSizePicker() {
  const current = useLifeSize();

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-3 w-56">
      <h2 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
        Grid size
      </h2>
      <div
        role="radiogroup"
        aria-label="Life grid size"
        // < xl: single row (S M L XL) — picker sits in the horizontal
        //       row above the grid where vertical real estate is tight.
        // ≥ xl: 2×2 grid (S M / L XL) — picker sits in the narrow
        //       sticky right rail where a shorter, wider shape reads
        //       better than a long pill strip.
        className="flex gap-1 xl:grid xl:grid-cols-2"
      >
        {SIZES.map(({ id, label }) => {
          const active = id === current;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLifeSize(id)}
              title={`${label} — ${LIFE_SIZE_PRESETS[id].cell}px cells`}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                active
                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
