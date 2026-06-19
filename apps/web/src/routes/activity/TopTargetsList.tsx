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
  /// Slice to the first `limit` rows (used by the dashboard widget).
  limit?: number;
  /// "full" page treatment vs "compact" dashboard widget. Compact shrinks
  /// the donut and tightens row padding so the widget fits in a tall
  /// scrolling column without dominating the viewport.
  variant?: 'full' | 'compact';
}

// Tailwind doesn't propagate dynamic class names into SVG `stroke` attrs,
// so the palette ships as raw hex values. Tinted per `kind` to reinforce
// the "apps = green family, sites = blue/purple family" convention already
// used in the hourly breakdown legend.
const APPS_PALETTE = [
  '#34d399', // emerald-400
  '#2dd4bf', // teal-400
  '#a3e635', // lime-400
  '#16a34a', // green-600
  '#22d3ee', // cyan-400
] as const;
const SITES_PALETTE = [
  '#38bdf8', // sky-400
  '#3b82f6', // blue-500
  '#06b6d4', // cyan-500
  '#818cf8', // indigo-400
  '#a78bfa', // violet-400
] as const;

export function TopTargetsList({
  title,
  kind,
  items,
  limit,
  variant = 'full',
}: TopTargetsListProps) {
  const shown = limit ? items.slice(0, limit) : items;
  const palette = kind === 'apps' ? APPS_PALETTE : SITES_PALETTE;
  const totalMs = shown.reduce((acc, row) => acc + row.durationMs, 0);

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
            palette={palette}
            totalMs={totalMs}
            size={isCompact ? 76 : 108}
            countLabel={kind}
          />
          <ol className="flex-1 space-y-1.5">
            {shown.map((row, i) => {
              const color = palette[i % palette.length];
              const shareOfTotal = totalMs === 0 ? 0 : row.durationMs / totalMs;
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
  const barWidth = compact ? 'w-10' : 'w-14';
  const durationWidth = compact ? 'w-14' : 'w-16';
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span
        className="flex-1 truncate text-neutral-200"
        title={`${name} — ${(shareOfTotal * 100).toFixed(1)}%`}
      >
        {name}
      </span>
      {/* Mini share-of-total progress bar — same hue as the donut segment. */}
      <span
        className={`relative h-1 overflow-hidden rounded-full bg-neutral-800 ${barWidth}`}
        aria-hidden
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${shareOfTotal * 100}%`, background: color }}
        />
      </span>
      <span
        className={`shrink-0 text-right font-mono tabular-nums text-neutral-300 ${durationWidth}`}
      >
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
  palette: readonly string[];
  totalMs: number;
  size: number;
  countLabel: 'apps' | 'sites';
}

function Donut({ items, palette, totalMs, size, countLabel }: DonutProps) {
  // SVG geometry — `pathLength={100}` normalises the stroke so we can use
  // percentages as raw 0..100 numbers in `strokeDasharray`.
  const radius = size * 0.42;
  const strokeWidth = size * 0.12;
  const cx = size / 2;
  const cy = size / 2;

  // Walk items in order, accumulating offsets so segments don't overlap.
  let cumulativePct = 0;
  const segments = items.map((item, i) => {
    const pct = totalMs === 0 ? 0 : (item.durationMs / totalMs) * 100;
    const offset = -cumulativePct;
    cumulativePct += pct;
    return {
      key: item.target,
      pct,
      offset,
      color: palette[i % palette.length],
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
        aria-label={`${items.length} ${countLabel}, total ${formatDurationCompact(totalMs)}`}
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
          {formatDurationCompact(totalMs)}
        </text>
      </svg>
    </div>
  );
}
