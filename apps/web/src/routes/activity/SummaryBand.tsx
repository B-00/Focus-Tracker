import type { ActivitySummaryResponse } from '@focus-tracker/shared';
import { formatDuration } from '../../lib/format-duration';

// "Top summary band" — the three big numbers above the breakdown chart
// (Activity.md §4.1). Apps + sites are the per-source slice of the
// total active time.

interface SummaryBandProps {
  summary: ActivitySummaryResponse;
}

export function SummaryBand({ summary }: SummaryBandProps) {
  const { totals } = summary;
  return (
    <section
      aria-label="Totals"
      className="grid grid-cols-3 gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <Stat label="Total active" value={formatDuration(totals.activeMs)} accent="emerald" />
      <Stat label="Apps" value={formatDuration(totals.apps)} accent="emerald" muted />
      <Stat label="Sites" value={formatDuration(totals.sites)} accent="sky" muted />
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  accent: 'emerald' | 'sky';
  muted?: boolean;
}

function Stat({ label, value, accent, muted = false }: StatProps) {
  // Static class strings so Tailwind's JIT can statically extract them.
  // Dynamic `text-${accent}-300` wouldn't get included in the bundle.
  const valueClass = muted
    ? 'text-neutral-300'
    : accent === 'emerald'
      ? 'text-emerald-300'
      : 'text-sky-300';
  return (
    <div>
      <p className="text-[0.7rem] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-2xl tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}
