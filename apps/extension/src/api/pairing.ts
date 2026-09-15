// Typed HTTP wrappers around the two unauthenticated pairing endpoints.
//
// Both endpoints are bootstrap-only (no JWT, no API key) — see
// PROJECT.md §12.6 / Auth.md §5.1. The claim step is done by the WEB
// app (with the user's JWT), not the extension.
//
// CORS: the API's default CORS allowlist is `http://localhost:5173`
// only. Extensions have `host_permissions: ["<all_urls>"]` in the
// manifest, which lets Firefox bypass CORS enforcement for extension-
// originated fetches. If the API later gains a stricter Origin check
// server-side, we'd move these fetches into the background page (where
// they'd need messaging plumbing but no CORS involvement).

import type {
  DeviceProposal,
  PairingCodeCreateResponse,
  PairingCodePollResponse,
  PairingErrorCode,
} from '@focus-tracker/shared';

import { getApiBaseUrl } from '../storage/device';

/**
 * Thrown by `createPairingCode` / `pollPairingCode` when the API rejects
 * the request with a JSON body containing a known `error` code. Lets
 * callers switch on `.code` for user-friendly messaging (esp. the 409
 * `device_already_paired` case where the user needs to revoke first).
 */
export class PairingApiError extends Error {
  readonly code: PairingErrorCode | 'unknown';
  readonly status: number;

  constructor(status: number, code: PairingErrorCode | 'unknown', message: string) {
    super(message);
    this.name = 'PairingApiError';
    this.status = status;
    this.code = code;
  }
}

export async function createPairingCode(
  proposal: DeviceProposal,
): Promise<PairingCodeCreateResponse> {
  const url = `${await getApiBaseUrl()}/v1/devices/pairing-codes`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(proposal),
    credentials: 'omit',
  });
  if (!res.ok) {
    throw await toPairingApiError(res, `POST /pairing-codes`);
  }
  return (await res.json()) as PairingCodeCreateResponse;
}

export async function pollPairingCode(code: string): Promise<PairingCodePollResponse> {
  const url = `${await getApiBaseUrl()}/v1/devices/pairing-codes/${encodeURIComponent(code)}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
  });
  // 404 = code expired / already consumed. We treat it the same as an
  // explicit `expired` status so the UI has one code path.
  if (res.status === 404) return { status: 'expired' };
  if (!res.ok) {
    throw await toPairingApiError(res, `GET /pairing-codes/${code}`);
  }
  return (await res.json()) as PairingCodePollResponse;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

/**
 * Best-effort structured error. The API returns `{error, hint}` JSON on
 * conflict cases (see PairingService); we surface the code so the UI
 * can localize / render friendlier text than a raw JSON blob.
 */
async function toPairingApiError(res: Response, label: string): Promise<PairingApiError> {
  const text = await safeText(res);
  let code: PairingErrorCode | 'unknown' = 'unknown';
  let hint = text;
  try {
    const parsed = JSON.parse(text) as { error?: string; hint?: string };
    if (typeof parsed.error === 'string') code = parsed.error as PairingErrorCode;
    if (typeof parsed.hint === 'string') hint = parsed.hint;
  } catch {
    /* not JSON — fall through with raw text */
  }
  return new PairingApiError(res.status, code, `${label} failed (${res.status}): ${hint}`);
}
