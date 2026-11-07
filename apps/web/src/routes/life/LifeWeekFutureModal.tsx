import { useMemo } from 'react';
import { Modal } from '../../components/Modal';
import { MilestonesSection } from './MilestonesSection';

// Future-week modal (MementoMori.md §5.3). The past/current variant
// (LifeWeekModal) drills into telemetry + sessions + notes; for future
// weeks there's nothing to measure yet, so this modal is intentionally
// slim: just the date-range header and the milestones section.

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;
const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export interface LifeWeekFutureModalProps {
  weekIndex: number | null;
  /// yyyy-mm-dd of the user's birthday. We derive the week's calendar
  /// range from this + weekIndex locally rather than making an API
  /// round-trip — the future-week endpoint doesn't exist (and doesn't
  /// need to; there's no telemetry to aggregate).
  birthday: string;
  onClose: () => void;
}

export function LifeWeekFutureModal({
  weekIndex,
  birthday,
  onClose,
}: LifeWeekFutureModalProps) {
  const open = weekIndex !== null;

  const window = useMemo(() => {
    if (weekIndex === null) return null;
    const b = parseYmd(birthday);
    if (!b) return null;
    const start = new Date(b.getTime() + weekIndex * MS_PER_WEEK);
    const end = new Date(start.getTime() + MS_PER_WEEK - 86_400_000);
    return {
      startDate: ymd(start),
      startLabel: DATE_FMT.format(start),
      endLabel: DATE_FMT.format(end),
    };
  }, [weekIndex, birthday]);

  const title = window ? `${window.startLabel} – ${window.endLabel}` : 'Week';
  const subtitle =
    weekIndex !== null
      ? `Week ${(weekIndex + 1).toLocaleString()} of your life · upcoming`
      : undefined;

  return (
    <Modal open={open} onClose={onClose} title={title} description={subtitle}>
      {weekIndex !== null && window && (
        <div className="flex flex-col gap-4">
          <p className="rounded border border-dashed border-neutral-800 bg-neutral-900/40 px-3 py-3 text-xs text-neutral-500">
            Nothing to measure yet. Add a milestone to mark this week on
            the grid.
          </p>
          <MilestonesSection
            weekIndex={weekIndex}
            weekStartDate={window.startDate}
          />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
//  Local helpers — tiny dep-free yyyy-mm-dd math
// ---------------------------------------------------------------------------

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
