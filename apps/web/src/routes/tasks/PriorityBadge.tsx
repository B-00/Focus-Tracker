import type { TaskPriority } from '@focus-tracker/shared';
import { usePriorityColors, withAlpha } from './priority-colors';
import { iconFor, usePriorityIcons } from './priority-icons';

// Priority badge — color + icon + label, consistent across every surface
// (/tasks, /calendar, /backlog, dashboard widgets). See Tasks.md §3.6.
//
// Accessibility: color is NEVER the sole indicator. Each badge carries
// the priority label as readable text and an aria-label matching the
// spec's keyboard-nav rules.
//
// Colors and icons come from the user-local stores so a swap in the
// rail legends instantly repaints every badge.

const LABELS: Record<TaskPriority, string> = {
  extreme: 'Extreme',
  high: 'High',
  mid: 'Mid',
  low: 'Low',
};

export const PRIORITY_SORT_INDEX: Record<TaskPriority, number> = {
  extreme: 0,
  high: 1,
  mid: 2,
  low: 3,
};

/// Compact Lucide glyph for surfaces that already apply color themselves
/// (calendar bars, tooltips). Subscribes to the icon store so a legend
/// pick repaints those spots too.
export function PriorityIcon({
  priority,
  size = 12,
}: {
  priority: TaskPriority;
  size?: number;
}) {
  const icons = usePriorityIcons();
  const Icon = iconFor(icons[priority]);
  return <Icon size={size} strokeWidth={2.5} aria-hidden />;
}

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
  const icons = usePriorityIcons();
  const label = LABELS[priority];
  const Icon = iconFor(icons[priority]);
  const hex = colors[priority];
  const style = {
    backgroundColor: withAlpha(hex, 0.2),
    borderColor: withAlpha(hex, 0.4),
    color: hex,
  } as const;

  if (variant === 'glyph') {
    return (
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border"
        style={style}
        aria-label={`${label} priority`}
        title={`${label} priority`}
      >
        <Icon size={12} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide"
      style={style}
      aria-label={`${label} priority`}
    >
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
