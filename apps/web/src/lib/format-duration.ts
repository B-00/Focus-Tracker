// Shared duration formatter for the Activity surfaces (and reusable
// anywhere else we render "1h 24m" style strings). All inputs are
// milliseconds; the output is space-separated, max 2 significant units.
//
// Reference shapes:
//   formatDuration(0)         → "0"
//   formatDuration(500)       → "<1s"
//   formatDuration(8_300)     → "8s"
//   formatDuration(95_000)    → "1m 35s"
//   formatDuration(3_600_000) → "1h"
//   formatDuration(5_400_000) → "1h 30m"

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    return '0';
  }
  if (ms < SECOND) return '<1s';

  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    const remMin = Math.floor((ms - hours * HOUR) / MINUTE);
    return remMin === 0 ? `${hours}h` : `${hours}h ${remMin}m`;
  }
  if (ms >= MINUTE) {
    const minutes = Math.floor(ms / MINUTE);
    const remSec = Math.floor((ms - minutes * MINUTE) / SECOND);
    return remSec === 0 ? `${minutes}m` : `${minutes}m ${remSec}s`;
  }
  return `${Math.floor(ms / SECOND)}s`;
}

/// Slightly tighter form for the breakdown chart's per-bucket hover
/// titles, where we want to fit two values side-by-side. Drops the
/// space between unit and number.
export function formatDurationCompact(ms: number): string {
  return formatDuration(ms).replace(/\s/g, '');
}
