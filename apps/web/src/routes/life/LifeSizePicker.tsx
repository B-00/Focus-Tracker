import {
  LIFE_SIZE_PRESETS,
  lifePresetFits,
  setLifeSize,
  useLifeSize,
  useViewportWidth,
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
  const fits = lifePresetFits(LIFE_SIZE_PRESETS[current], useViewportWidth());

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-3 w-56 xl:w-fit">
      <h2 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
        Grid size
      </h2>
      <div
        role="radiogroup"
        aria-label="Life grid size"
        // < xl: single row (S M L XL), buttons stretch via flex-1 to
        //       fill the fixed-width section — picker sits in the
        //       horizontal row above the grid where vertical real
        //       estate is tight.
        // ≥ xl: 2×2 grid (S M / L XL) with auto-sized columns so
        //       buttons shrink to their label, giving a compact pill
        //       cluster in the narrow sticky right rail.
        className="flex gap-1 xl:grid xl:grid-cols-[auto_auto]"
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
              // flex-1 stretches evenly in the <xl flex row; xl:w-10
              // (40px) gives all four pills a uniform compact width in
              // the 2×2 grid so S / M don't look narrower than XL.
              className={`flex-1 rounded px-2 py-1 text-xs font-medium transition xl:w-10 xl:flex-none ${
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
      {!fits && (
        <p className="mt-2 text-[0.65rem] text-neutral-500">Shrunk to fit this screen</p>
      )}
    </section>
  );
}
