// Pairing + Device wire contracts shared by the API, web app, and source
// clients (browser extension + desktop app).
//
// Owner: Auth.md §5 (pairing flow, API-key minting), PROJECT.md §12.6
// (endpoint inventory), Sources Markdown/{Extension,DesktopApp}.md §4
// (client-side pairing UX).

import { z } from 'zod';
import { DEVICE_SOURCES } from './enums.js';

// ---------------------------------------------------------------------------
//  Device proposal (the JSON payload embedded inside a PairingCode)
// ---------------------------------------------------------------------------

/// The device-supplied metadata that becomes a `Device` row on a successful
/// claim. `deviceId` is a UUIDv4 the client generates ONCE at install time
/// and persists locally (OS keychain for desktop, chrome.storage.local for
/// the extension) so re-pairings keep the same identity.
export const deviceProposalSchema = z.object({
  deviceId: z.string().uuid(),
  source: z.enum(DEVICE_SOURCES),
  /// Human OS / browser string, e.g. "Windows 11 23H2", "Firefox 126".
  /// Free-form display field, not parsed server-side.
  platform: z.string().min(1).max(120),
  /// User-editable label. Defaults to something like hostname / browser
  /// name on the client; the web app's Settings → Devices lets the user
  /// rename it later.
  label: z.string().min(1).max(60),
  /// Semver of the source client itself, e.g. "1.0.0".
  clientVersion: z.string().min(1).max(40).optional(),
});
export type DeviceProposal = z.infer<typeof deviceProposalSchema>;

// ---------------------------------------------------------------------------
//  POST /v1/devices/pairing-codes  (no auth — bootstrap)
// ---------------------------------------------------------------------------

export const pairingCodeCreateRequestSchema = deviceProposalSchema;
export type PairingCodeCreateRequest = z.infer<typeof pairingCodeCreateRequestSchema>;

export const pairingCodeCreateResponseSchema = z.object({
  /// 6 numeric digits, leading zeros preserved. Always a 6-char string.
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.string().datetime(),
});
export type PairingCodeCreateResponse = z.infer<typeof pairingCodeCreateResponseSchema>;

// ---------------------------------------------------------------------------
//  GET /v1/devices/pairing-codes/:code  (no auth — bootstrap)
// ---------------------------------------------------------------------------

/// Discriminated union — the client switches on `status`.
/// `pending`  → keep polling
/// `claimed`  → store apiKey + deviceId, stop polling
/// `expired`  → start over with a fresh code
export type PairingCodePollResponse =
  | { status: 'pending' }
  | {
      status: 'claimed';
      /// Raw `ft_live_...` API key. Returned exactly ONCE — the
      /// PairingCode row is deleted immediately after this response so
      /// subsequent polls return 404. The client MUST persist this in
      /// secure storage (OS keychain / chrome.storage.local) before
      /// acknowledging completion to its UI.
      apiKey: string;
      device: { id: string; label: string };
    }
  | { status: 'expired' };

// ---------------------------------------------------------------------------
//  POST /v1/devices/pairing-codes/:code/claim  (JWT auth — web app)
// ---------------------------------------------------------------------------

/// The web app submits ONLY the code itself (path param). Device metadata
/// already lives in the server-side PairingCode row from step 1.
export const pairingCodeClaimResponseSchema = z.object({
  deviceId: z.string().uuid(),
  label: z.string(),
});
export type PairingCodeClaimResponse = z.infer<typeof pairingCodeClaimResponseSchema>;

// ---------------------------------------------------------------------------
//  GET /v1/devices  (JWT auth — web app)
// ---------------------------------------------------------------------------

/// Projection of `Device` for Settings → Devices. Does NOT include the API
/// key (the user can't and shouldn't see it).
export const deviceListItemSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(DEVICE_SOURCES),
  label: z.string(),
  platform: z.string().nullable(),
  clientVersion: z.string().nullable(),
  pairedAt: z.string().datetime(),
  lastSeen: z.string().datetime().nullable(),
  lastSuccessfulIngestAt: z.string().datetime().nullable(),
});
export type DeviceListItem = z.infer<typeof deviceListItemSchema>;

// ---------------------------------------------------------------------------
//  Error codes — extends the AuthErrorCode union for client switch()
// ---------------------------------------------------------------------------

export const PAIRING_ERROR_CODES = [
  'pairing_code_invalid', // GET /pairing-codes/{code} or claim on a code that doesn't exist / expired
  'pairing_code_already_claimed', // claim called twice
  'pairing_code_pending', // poll while not yet claimed (also signalled by status=pending — see §poll response)
  'device_not_found', // DELETE /devices/{id} for unknown id
] as const;
export type PairingErrorCode = (typeof PAIRING_ERROR_CODES)[number];
