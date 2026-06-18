// Same lightweight Intl.RelativeTimeFormat wrapper as apps/web.
// Duplicated rather than shared because @focus-tracker/shared is meant for
// wire-protocol shapes, not UI utilities; this is ~20 lines and trivially
// kept in sync.

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
      return RTF.format(Math.round(diffMs / ms), unit);
    }
  }
  return 'just now';
}
