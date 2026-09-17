// Telemetry-batch upload wrapper.
//
// Wraps POST /v1/telemetry/batch with the per-device API key. Auth is
// `Authorization: Bearer <ft_live_...>` — see Auth.md §5.3.
//
// The API's status contract (Auth.md §5 + telemetry service):
//   * 2xx                     → success, deletable from outbox
//   * 401  token_invalid /    → API key not recognised. Client should
//        token_wrong_type       forget the paired device and re-pair.
//   * 403  api_key_revoked    → same handling as 401 (auth rejected).
//   * 4xx (other)             → bad batch shape. v1 drops it — retrying
//                              the same bytes will fail identically.
//   * 5xx / network / timeout → transient. Leave in outbox, retry on
//                              the next flush tick.
//
// We do NOT strip NUL bytes client-side: the API strips them in
// TelemetryService.ingest() (see stripNulBytes hotfix landed on main),
// so the extension can send raw event bodies and rely on the server-
// side sanitiser. Keeps client + server contract in one place.

import type { TelemetryBatch, TelemetryBatchResponse } from '@focus-tracker/shared';

import { getApiBaseUrl } from '../storage/device';
// `UploadResult` lives in drain.ts so the pure drain-loop self-check
// (background/flusher.check.ts) can exercise the branch logic without
// pulling in `fetch` / `browser.*` transitively.
import type { UploadResult } from '../background/drain';
export type { UploadResult } from '../background/drain';

export async function uploadBatch(
  batch: TelemetryBatch,
  apiKey: string,
): Promise<UploadResult> {
  const url = `${await getApiBaseUrl()}/v1/telemetry/batch`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(batch),
      credentials: 'omit',
    });
  } catch (err) {
    // Fetch throws only on network-level failures (DNS, TLS, offline,
    // aborted). Everything with an HTTP response — including 5xx — is
    // available on `res` below.
    return { status: 'transient', message: (err as Error).message };
  }

  if (res.ok) {
    try {
      const response = (await res.json()) as TelemetryBatchResponse;
      return { status: 'ok', response };
    } catch (err) {
      // Server accepted but returned malformed JSON. Treat as transient
      // so we don't lose the events; a retry should either succeed or
      // return a clearer error status.
      return { status: 'transient', message: `parse error: ${(err as Error).message}` };
    }
  }

  const body = await safeText(res);
  if (res.status === 401 || res.status === 403) {
    return { status: 'auth_rejected', message: `${res.status}: ${body}` };
  }
  if (res.status >= 400 && res.status < 500) {
    return { status: 'permanent', message: `${res.status}: ${body}` };
  }
  return { status: 'transient', message: `${res.status}: ${body}` };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

/**
 * Cheap reachability probe. Used by the popup on open when the stored
 * reachability status (updated by the flusher) is missing or stale.
 * Requires no auth — the API's `/v1/health` endpoint is unguarded.
 */
export async function probeHealth(): Promise<{ reachable: boolean; message?: string }> {
  const url = `${await getApiBaseUrl()}/v1/health`;
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit' });
    if (res.ok) return { reachable: true };
    return { reachable: false, message: `${res.status}` };
  } catch (err) {
    return { reachable: false, message: (err as Error).message };
  }
}
