import type { ActivityTargetTotal } from '@focus-tracker/shared';
import { formatDuration, formatDurationCompact } from '../../lib/format-duration';

// Top apps / top sites — donut chart on the left, ranked list on the right.
// Each row dot, donut segment, and mini-bar share a color so the eye can
// link rank → segment → bar without thinking.
//
// Spec (Activity.md §4.1) caps the list at 5 (page) / 3 (dashboard widget
// via `limit`). Render is a real `<ol>` so screen readers announce rank.

interface TopTargetsListProps {
  title: string;
  /// "apps" | "sites" — drives empty-state copy and the color palette.
  kind: 'apps' | 'sites';
  items: ActivityTargetTotal[];
  /// The API's true total for this `kind` over the active range —
  /// `summary.totals.apps` or `summary.totals.sites`. Used as the donut
  /// center value AND the denominator for segment + bar percentages so
  /// the donut, the row bars, and the SummaryBand all agree on what
  /// "total" means. When the top-N list doesn't account for the whole
  /// kind (e.g. apps ranked 6+ contributing some time), the leftover
  /// shows up as the dark portion of the ring — visually honest about
  /// "Other".
  totalMsForKind: number;
  /// Slice to the first `limit` rows (used by the dashboard widget).
  limit?: number;
  /// "full" page treatment vs "compact" dashboard widget. Compact shrinks
  /// the donut and tightens row padding so the widget fits in a tall
  /// scrolling column without dominating the viewport.
  variant?: 'full' | 'compact';
}

// Tailwind doesn't propagate dynamic class names into SVG `stroke` attrs,
// so the palette ships as raw hex values. Shared between Top Apps and Top
// Sites — color identifies rank, not kind. The `kind` distinction lives in
// the section title and the "desktop / browser" badge in the header.
const PALETTE = [
  '#f75590', // pink
  '#2191fb', // blue
  '#fbd87f', // yellow
  '#b5f8fe', // light cyan
  '#10ffcb', // aqua
] as const;

export function TopTargetsList({
  title,
  kind,
  items,
  totalMsForKind,
  limit,
  variant = 'full',
}: TopTargetsListProps) {
  const shown = limit ? items.slice(0, limit) : items;
  // Denominator for both segment and bar percentages. Falls back to the
  // sum of the visible rows only when the API reports zero total — which
  // shouldn't happen alongside non-empty `items`, but guards against
  // divide-by-zero either way.
  const denom = totalMsForKind > 0
    ? totalMsForKind
    : shown.reduce((acc, row) => acc + row.durationMs, 0);

  const isCompact = variant === 'compact';
  const padding = isCompact ? 'p-3' : 'p-4';

  return (
    <section className={`rounded-lg border border-neutral-800 bg-neutral-900/40 ${padding}`}>
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[0.7rem] uppercase tracking-wider text-neutral-500">{title}</h3>
        <span className="text-[0.65rem] text-neutral-500">
          {kind === 'apps' ? 'desktop' : 'browser'}
        </span>
      </header>

      {shown.length === 0 ? (
        <p className="py-2 text-sm text-neutral-500">
          {kind === 'apps'
            ? 'No app data yet. Open the desktop app to start tracking.'
            : 'No site data yet. The browser extension will fill this in.'}
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <Donut
            items={shown}
            denom={denom}
            centerTotalMs={totalMsForKind}
            size={isCompact ? 76 : 108}
            countLabel={kind}
          />
          <ol className="flex-1 space-y-1.5">
            {shown.map((row, i) => {
              const color = PALETTE[i % PALETTE.length];
              const shareOfTotal = denom === 0 ? 0 : row.durationMs / denom;
              return (
                <Row
                  key={row.target}
                  name={row.target}
                  durationMs={row.durationMs}
                  shareOfTotal={shareOfTotal}
                  color={color}
                  compact={isCompact}
                />
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Row
// ---------------------------------------------------------------------------

interface RowProps {
  name: string;
  durationMs: number;
  shareOfTotal: number; // 0..1, share of the visible total
  color: string;
  compact: boolean;
}

function Row({ name, durationMs, shareOfTotal, color, compact }: RowProps) {
  // Grid layout: two equal-width "boxes" for name + bar side by side, with
  // dot and duration pinned to the edges.
  //   col 1: auto             — color dot
  //   col 2: minmax(0, 1fr)   — name "box"; left-aligned text, truncates if
  //                             the row gets squeezed
  //   col 3: minmax(0, 1fr)   — bar "box"; gray track fills the box, colored
  //                             fill left-aligned and sized to share-of-total
  //   col 4: fixed            — duration; mono + tabular-nums + fixed width
  //                             so every row's duration starts at the same x
  const durationWidth = compact ? '3.5rem' : '4rem';
  return (
    <li
      className="grid items-center gap-3 text-sm"
      style={{
        gridTemplateColumns: `auto minmax(0, 1fr) minmax(0, 1fr) ${durationWidth}`,
      }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span
        className="truncate text-neutral-200"
        title={`${name} — ${(shareOfTotal * 100).toFixed(1)}%`}
      >
        {name}
      </span>
      {/* Share-of-total progress bar. Outer <div> forces block-level so it
          fills the grid cell predictably (inline <span> was being treated as
          shrink-to-fit by some browsers even inside a grid container). */}
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
        aria-hidden
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${shareOfTotal * 100}%`, background: color }}
        />
      </div>
      <span className="text-right font-mono tabular-nums text-neutral-300">
        {compact ? formatDurationCompact(durationMs) : formatDuration(durationMs)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
//  Donut chart
// ---------------------------------------------------------------------------

interface DonutProps {
  items: ActivityTargetTotal[];
  /// Denominator for segment percentages. When equal to sum(items) the
  /// ring fills 100% — otherwise the leftover dark portion represents
  /// "Other" (apps ranked 6+ or sites not in the top N).
  denom: number;
  /// What the center prints. Matches the SummaryBand's per-kind total so
  /// both readouts agree.
  centerTotalMs: number;
  size: number;
  countLabel: 'apps' | 'sites';
}

function Donut({ items, denom, centerTotalMs, size, countLabel }: DonutProps) {
  // SVG geometry — `pathLength={100}` normalises the stroke so we can use
  // percentages as raw 0..100 numbers in `strokeDasharray`.
  const radius = size * 0.42;
  const strokeWidth = size * 0.12;
  const cx = size / 2;
  const cy = size / 2;

  // Walk items in order, accumulating offsets so segments don't overlap.
  // Segments are share-of-`denom`, so when the top-N doesn't cover the
  // whole kind the ring naturally leaves room for the "Other" portion.
  let cumulativePct = 0;
  const segments = items.map((item, i) => {
    const pct = denom === 0 ? 0 : (item.durationMs / denom) * 100;
    const offset = -cumulativePct;
    cumulativePct += pct;
    return {
      key: item.target,
      pct,
      offset,
      color: PALETTE[i % PALETTE.length],
    };
  });

  const isLargeSize = size >= 96;
  const countFontSize = isLargeSize ? '1.5rem' : '1.1rem';
  const labelFontSize = isLargeSize ? '0.62rem' : '0.55rem';
  const totalFontSize = isLargeSize ? '0.62rem' : '0.55rem';

  return (
    <div className="shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`Top ${items.length} ${countLabel}, total ${formatDurationCompact(centerTotalMs)}`}
      >
        {/* Track ring — visible on empty / sub-100% donuts. */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(38, 38, 38, 0.55)"
          strokeWidth={strokeWidth}
        />
        {/* Segments — rotated -90° so the first one starts at 12 o'clock. */}
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              pathLength={100}
              strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
              strokeDashoffset={seg.offset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        {/* Center label — count big, total time small. */}
        <text
          x={cx}
          y={cy - (isLargeSize ? 4 : 2)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#f5f5f5"
          fontWeight={700}
          style={{ fontSize: countFontSize }}
        >
          {items.length}
        </text>
        <text
          x={cx}
          y={cy + (isLargeSize ? 12 : 9)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#737373"
          style={{ fontSize: labelFontSize, textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          {countLabel}
        </text>
        <text
          x={cx}
          y={cy + (isLargeSize ? 24 : 19)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#a3a3a3"
          fontFamily="ui-monospace, monospace"
          style={{ fontSize: totalFontSize }}
        >
          {formatDurationCompact(centerTotalMs)}
        </text>
      </svg>
    </div>
  );
}
