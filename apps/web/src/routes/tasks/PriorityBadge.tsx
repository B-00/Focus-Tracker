import type { TaskPriority } from '@focus-tracker/shared';
import { usePriorityColors, withAlpha } from './priority-colors';

// Priority badge — color + glyph + label, consistent across every surface
// (/tasks, /calendar, /backlog, dashboard widgets). See Tasks.md §3.6.
//
// Accessibility: color is NEVER the sole indicator. Each badge carries
// the priority label as readable text and an aria-label matching the
// spec's keyboard-nav rules.
//
// Colors come from the user-local palette hook (priority-colors.ts) so
// a swap in the Change Task Color picker instantly repaints every badge.

const META: Record<TaskPriority, { glyph: string; label: string }> = {
  extreme: { glyph: '▲▲', label: 'Extreme' },
  high: { glyph: '▲', label: 'High' },
  mid: { glyph: '●', label: 'Mid' },
  low: { glyph: '▽', label: 'Low' },
};

export const PRIORITY_SORT_INDEX: Record<TaskPriority, number> = {
  extreme: 0,
  high: 1,
  mid: 2,
  low: 3,
};

interface PriorityBadgeProps {
  priority: TaskPriority;
  /// "chip" (default) = full pill with glyph + label.
  /// "glyph" = compact glyph-only for tight rows / dashboard widgets.
  variant?: 'chip' | 'glyph';
}

export function PriorityBadge({
  priority,
  variant = 'chip',
}: PriorityBadgeProps) {
  const colors = usePriorityColors();
  const m = META[priority];
  const hex = colors[priority];
  const style = {
    backgroundColor: withAlpha(hex, 0.2),
    borderColor: withAlpha(hex, 0.4),
    color: hex,
  } as const;

  if (variant === 'glyph') {
    return (
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[0.65rem] font-semibold"
        style={style}
        aria-label={`${m.label} priority`}
        title={`${m.label} priority`}
      >
        {m.glyph}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide"
      style={style}
      aria-label={`${m.label} priority`}
    >
      <span aria-hidden="true">{m.glyph}</span>
      <span>{m.label}</span>
    </span>
  );
}
