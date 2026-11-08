import { memo } from 'react';

// Shared corner pin for life-grid cells (full /life grid + the
// Dashboard life strip). A single dot whose color encodes the
// milestone count on that cell: 1 / 2 / 3+. Colors live in the
// life-colors store and are published as --c-m1..m3 CSS vars so a
// picker drag is one style write, not a React re-render of cells.
// pointer-events-none so the cell's click target stays with the parent.

export function markerVar(count: number): string {
  if (count >= 3) return 'var(--c-m3)';
  if (count === 2) return 'var(--c-m2)';
  return 'var(--c-m1)';
}

export interface MilestoneMarkerProps {
  count: number;
  /// Side of the cell in CSS px — the pin scales with it so it looks
  /// right on both the S/M/L/XL main grid and the tiny 8px dashboard
  /// strip. Defaults to 8 (a dot, not a badge).
  size?: number;
}

export const MilestoneMarker = memo(function MilestoneMarker({
  count,
  size = 8,
}: MilestoneMarkerProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -right-0.5 -top-0.5 rounded-full ring-1 ring-black/40"
      style={{
        backgroundColor: markerVar(count),
        width: size,
        height: size,
      }}
    />
  );
});
