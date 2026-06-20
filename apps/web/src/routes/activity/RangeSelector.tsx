import { ACTIVITY_RANGES, type ActivityRange } from '@focus-tracker/shared';

// Range dropdown for the Activity page. Mirrors the spec's `[ Today ▾ ]`
// affordance (Activity.md §4.1).
//
// We render a real `<select>` for accessibility — `aria-label`, native
// keyboard, screen-reader announcements all come for free. Styling
// matches the rest of the app's controls (dark surface, subtle border,
// focus ring).

const LABELS: Record<ActivityRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

interface RangeSelectorProps {
  value: ActivityRange;
  onChange: (next: ActivityRange) => void;
  disabled?: boolean;
}

export function RangeSelector({ value, onChange, disabled }: RangeSelectorProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ActivityRange)}
      aria-label="Time range"
      className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-sm text-neutral-200 transition hover:border-neutral-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
    >
      {ACTIVITY_RANGES.map((r) => (
        <option key={r} value={r}>
          {LABELS[r]}
        </option>
      ))}
    </select>
  );
}
