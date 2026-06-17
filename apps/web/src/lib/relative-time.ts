// Minimal "2 minutes ago" formatter built on Intl.RelativeTimeFormat so we
// don't pull in date-fns (~12KB) just for this. Owned by Settings → Devices
// (Settings.md §4.4), reused anywhere we render a "last X ago" string.
//
// Returns "Never" for null inputs so callers can pass `Device.lastSeen`
// straight through.

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

export function relativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return 'Never';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Never';
  const diffMs = then.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);

  for (const { unit, ms } of UNITS) {
    if (absMs >= ms || unit === 'second') {
      const value = Math.round(diffMs / ms);
      return RTF.format(value, unit);
    }
  }
  return 'just now';
}

/// True if the given ISO timestamp is more than `thresholdHours` in the past.
/// Used to flag stale ingest (Settings.md §4.4 — the ⚠ pill).
export function isStale(
  iso: string | null | undefined,
  thresholdHours: number,
  now: Date = new Date(),
): boolean {
  if (!iso) return false;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  return now.getTime() - then.getTime() > thresholdHours * 60 * 60 * 1000;
}
