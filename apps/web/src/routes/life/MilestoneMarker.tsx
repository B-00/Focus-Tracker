import { memo } from 'react';
import { iconFor } from './MilestonesSection';

// Shared corner pin for life-grid cells (full /life grid + the
// Dashboard life strip). A single circle whose color encodes the
// milestone count on that cell: 1 = blue, 2 = pink, 3+ = gold.
// pointer-events-none so the cell's click target stays with the parent.

const MARKER_ICON = iconFor(null); // generic MilestoneIcon

export function markerColor(count: number): string {
  if (count >= 3) return '#f59e0b'; // gold
  if (count === 2) return '#ec4899'; // pink
  return '#3b82f6'; // blue
}

export interface MilestoneMarkerProps {
  count: number;
  /// Side of the cell in CSS px — the pin scales with it so it looks
  /// right on both the S/M/L/XL main grid and the tiny 8px dashboard
  /// strip. Defaults to 12.
  size?: number;
}

export const MilestoneMarker = memo(function MilestoneMarker({
  count,
  size = 12,
}: MilestoneMarkerProps) {
  const color = markerColor(count);
  // Icon = ~65% of the circle so it stays legible at every scale.
  const iconSize = Math.max(4, Math.round(size * 0.65));
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -right-0.5 -top-0.5"
    >
      <span
        className="flex items-center justify-center rounded-full ring-1 ring-black/40"
        style={{ backgroundColor: color, width: size, height: size }}
      >
        <MARKER_ICON size={iconSize} className="text-black/70" strokeWidth={3} />
      </span>
    </div>
  );
});
