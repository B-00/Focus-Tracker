import type { TaskPriority } from '@focus-tracker/shared';

// Priority badge — color + glyph + label, consistent across every surface
// (/tasks, /calendar, /backlog, dashboard widgets). See Tasks.md §3.6.
//
// Accessibility: color is NEVER the sole indicator. Each badge carries
// the priority label as readable text and an aria-label matching the
// spec's keyboard-nav rules.

const STYLES: Record<
  TaskPriority,
  { glyph: string; label: string; chip: string }
> = {
  extreme: {
    glyph: '▲▲',
    label: 'Extreme',
    chip: 'bg-red-500/20 text-red-300 border-red-500/40',
  },
  high: {
    glyph: '▲',
    label: 'High',
    chip: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  },
  mid: {
    glyph: '●',
    label: 'Mid',
    chip: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  low: {
    glyph: '▽',
    label: 'Low',
    chip: 'bg-purple-400/20 text-purple-300 border-purple-400/40',
  },
};

/// Per-priority row background tint. Lives here (next to STYLES) so the
/// badge and the row glow stay color-synced if the palette ever shifts.
/// Static class strings so Tailwind's JIT compiler can see them.
export const PRIORITY_ROW_BG: Record<TaskPriority, string> = {
  extreme: 'bg-red-500/10 hover:bg-red-500/15',
  high: 'bg-orange-500/10 hover:bg-orange-500/15',
  mid: 'bg-emerald-500/10 hover:bg-emerald-500/15',
  low: 'bg-purple-400/10 hover:bg-purple-400/15',
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
  const s = STYLES[priority];
  if (variant === 'glyph') {
    return (
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[0.65rem] font-semibold ${s.chip}`}
        aria-label={`${s.label} priority`}
        title={`${s.label} priority`}
      >
        {s.glyph}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${s.chip}`}
      aria-label={`${s.label} priority`}
    >
      <span aria-hidden="true">{s.glyph}</span>
      <span>{s.label}</span>
    </span>
  );
}
