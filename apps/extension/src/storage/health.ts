// API reachability signal, persisted in `browser.storage.local`.
//
// Extension.md §17: "the event page validates the URL is reachable
// (HEAD /v1/health) and surfaces a clear error in the popup if not."
//
// We do NOT run a dedicated HEAD probe on every event-page wake — that
// would be a lot of HTTPS traffic given the event page wakes on every
// tab event. Instead the flusher (`background/flusher.ts`) records the
// outcome of every real batch upload it attempts, since those hit the
// same host and give a strictly stronger signal (full round-trip with
// auth) than a HEAD.
//
// The popup falls back to firing a HEAD /v1/health probe on open if
// the stored status is missing or stale, so the reachability pill is
// never blank.

const KEY = 'apiHealth';

/// How stale the stored status can be before the popup does a fresh
/// HEAD probe on open (5 minutes = a few flush ticks late, but not
/// so far past that the user has been staring at a lie).
export const STALE_AFTER_MS = 5 * 60 * 1000;

export interface HealthStatus {
  reachable: boolean;
  /// ISO-8601. Presented to the user as "checked N seconds ago".
  checkedAt: string;
  /// Optional short reason for `!reachable` — e.g. "503: gateway timeout".
  message?: string;
}

export async function getHealth(): Promise<HealthStatus | null> {
  const bag = await browser.storage.local.get(KEY);
  const raw = bag[KEY] as Partial<HealthStatus> | undefined;
  if (
    !raw ||
    typeof raw.reachable !== 'boolean' ||
    typeof raw.checkedAt !== 'string'
  ) {
    return null;
  }
  const status: HealthStatus = { reachable: raw.reachable, checkedAt: raw.checkedAt };
  if (typeof raw.message === 'string') status.message = raw.message;
  return status;
}

export async function setHealth(status: HealthStatus): Promise<void> {
  await browser.storage.local.set({ [KEY]: status });
}

/// Whether the popup should treat the stored status as stale and run
/// a fresh HEAD probe. Returns true for a missing status too.
export function isStale(status: HealthStatus | null, now: Date = new Date()): boolean {
  if (status === null) return true;
  const ageMs = now.getTime() - new Date(status.checkedAt).getTime();
  return ageMs >= STALE_AFTER_MS;
}
