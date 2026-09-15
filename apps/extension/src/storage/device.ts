// Device-identity persistence in `browser.storage.local`.
//
// Persisted keys:
//   deviceId    UUIDv4, generated ONCE at first pair attempt. Kept
//               across re-pairings so the API links this Firefox
//               profile to the same Device row.
//   apiKey      Raw ft_live_... key returned by the pairing claim.
//               Present iff paired.
//   deviceLabel Human name of the paired device. Present iff paired.
//   apiBaseUrl  API base (default: http://localhost:3000). Slice 5
//               will surface this in the Options page; for now it's
//               settable only by editing storage directly.

const KEY_DEVICE_ID = 'deviceId';
const KEY_API_KEY = 'apiKey';
const KEY_DEVICE_LABEL = 'deviceLabel';
const KEY_API_BASE_URL = 'apiBaseUrl';
const KEY_PENDING_PAIRING = 'pendingPairing';

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

/**
 * Return the persistent device id, generating one on first call. Safe to
 * call anywhere; the ID is written back to storage before this resolves
 * so subsequent calls return the same value.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const bag = await browser.storage.local.get(KEY_DEVICE_ID);
  const existing = bag[KEY_DEVICE_ID];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  // Use `crypto.randomUUID()` — available in modern Firefox and same
  // format (UUIDv4) as the pairingCode schema requires.
  const fresh = crypto.randomUUID();
  await browser.storage.local.set({ [KEY_DEVICE_ID]: fresh });
  return fresh;
}

export async function getApiBaseUrl(): Promise<string> {
  const bag = await browser.storage.local.get(KEY_API_BASE_URL);
  const stored = bag[KEY_API_BASE_URL];
  return typeof stored === 'string' && stored.length > 0 ? stored : DEFAULT_API_BASE_URL;
}

export interface PairedDevice {
  deviceId: string;
  apiKey: string;
  label: string;
}

/**
 * Return the paired-device payload iff we're paired. Null means the
 * popup should show the pairing screen.
 */
export async function getPairedDevice(): Promise<PairedDevice | null> {
  const bag = await browser.storage.local.get([KEY_DEVICE_ID, KEY_API_KEY, KEY_DEVICE_LABEL]);
  const deviceId = bag[KEY_DEVICE_ID];
  const apiKey = bag[KEY_API_KEY];
  const label = bag[KEY_DEVICE_LABEL];
  if (
    typeof deviceId !== 'string' ||
    typeof apiKey !== 'string' ||
    typeof label !== 'string'
  ) {
    return null;
  }
  return { deviceId, apiKey, label };
}

export async function savePairedDevice(input: { apiKey: string; label: string }): Promise<void> {
  await browser.storage.local.set({
    [KEY_API_KEY]: input.apiKey,
    [KEY_DEVICE_LABEL]: input.label,
  });
}

/** For a future "unpair this device" button. Not wired in Slice 3. */
export async function forgetPairedDevice(): Promise<void> {
  await browser.storage.local.remove([KEY_API_KEY, KEY_DEVICE_LABEL]);
}

// -----------------------------------------------------------------------------
//  Pending-pairing bookkeeping
// -----------------------------------------------------------------------------
//
// The Firefox popup is destroyed the instant the user clicks outside it
// (e.g. to the web dashboard tab to enter the code). If we regenerate a
// fresh code on every popup open, the server sees N pending codes and
// the second attempt hits 409 because the Device row got created by the
// first successful claim. Persist the outstanding code so the popup can
// resume polling on reopen instead of asking the server for another one.

export interface PendingPairing {
  code: string;
  /** ISO-8601 string; matches the API's PairingCodeCreateResponse.expiresAt. */
  expiresAt: string;
}

export async function getPendingPairing(): Promise<PendingPairing | null> {
  const bag = await browser.storage.local.get(KEY_PENDING_PAIRING);
  const raw = bag[KEY_PENDING_PAIRING];
  if (typeof raw !== 'object' || raw === null) return null;
  const { code, expiresAt } = raw as Partial<PendingPairing>;
  if (typeof code !== 'string' || typeof expiresAt !== 'string') return null;
  // Drop expired entries eagerly — server would 404 anyway.
  if (new Date(expiresAt).getTime() <= Date.now()) {
    await clearPendingPairing();
    return null;
  }
  return { code, expiresAt };
}

export async function savePendingPairing(pending: PendingPairing): Promise<void> {
  await browser.storage.local.set({ [KEY_PENDING_PAIRING]: pending });
}

export async function clearPendingPairing(): Promise<void> {
  await browser.storage.local.remove(KEY_PENDING_PAIRING);
}
