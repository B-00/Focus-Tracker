// Compact SVG donut chart.
//
// One segment per top-N domain, painted with `PALETTE[i]`. Anything
// beyond the top N (or filler when the day is empty) uses `OTHER_COLOR`
// so the ring is always visually complete.
//
// SVG is the right tool here: crisp at any DPI, no canvas ceremony, no
// external chart lib. ~50 LOC beats adding a dep for this.

import type { JSX } from 'preact';

import { OTHER_COLOR, PALETTE } from './palette';

export interface DonutSegment {
  domain: string;
  durationMs: number;
}

interface DonutProps {
  segments: DonutSegment[]; // already sorted desc, top-N ish
  totalMs: number; // full day's captured time incl. "Other"
  size?: number; // pixels
  strokeWidth?: number;
}

export function Donut({
  segments,
  totalMs,
  size = 180,
  strokeWidth = 24,
}: DonutProps): JSX.Element {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  // Track ring — full 360° in the "Other" color, then the segments
  // paint over the top starting from 12 o'clock going clockwise.
  const trackDash = circumference;

  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Today's time by site">
      {/* rotate -90° so the first segment starts at 12 o'clock, not 3 o'clock */}
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={OTHER_COLOR}
          strokeWidth={strokeWidth}
          strokeDasharray={`${trackDash} ${circumference}`}
        />
        {totalMs > 0 &&
          segments.map((seg, i) => {
            const fraction = seg.durationMs / totalMs;
            const dash = fraction * circumference;
            const el = (
              <circle
                key={seg.domain}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
      </g>
    </svg>
  );
}
