// `/v1/me/profile` contract shared by the API and the web app.
//
// Owner: Features Markdown/Settings.md §4.1 (Profile section) + §6.3 (endpoints).
//
// v1 scope: `timezone` + `timezoneOverridden` only. The other Settings fields
// (displayName, birthday, lifeExpectancyYears) are listed in the schema for
// forward-compat but the auto-detect path only ever touches `timezone`. When
// the Settings UI lands we'll start sending the rest from the same endpoint.

import { z } from 'zod';

// ---------------------------------------------------------------------------
//  GET /v1/me/profile  →  full profile
// ---------------------------------------------------------------------------

export const meProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  birthday: z.string().nullable(),          // ISO date (yyyy-mm-dd) or null
  lifeExpectancyYears: z.number().int().positive(),
  timezone: z.string(),                     // IANA tz name, e.g. "America/New_York"
  timezoneOverridden: z.boolean(),
});
export type MeProfileResponse = z.infer<typeof meProfileResponseSchema>;

// ---------------------------------------------------------------------------
//  PATCH /v1/me/profile
// ---------------------------------------------------------------------------

/// Partial profile update. All fields optional — the server applies only what
/// is present. `autoDetect` is the discriminator between the two timezone
/// flows defined in Settings.md §4.1.1:
///
///   * `autoDetect: true`  → silent backfill from the browser. Server applies
///     the supplied `timezone` only if `timezoneOverridden = false` and does
///     NOT flip the override flag. No-op for users who've manually overridden.
///   * `autoDetect: false` (default) → manual edit. Server applies the
///     supplied `timezone` unconditionally and sets `timezoneOverridden = true`.
///
/// IANA-validity is enforced server-side via `Intl.DateTimeFormat` (Settings.md
/// §6.3 "Validates IANA timezone format if `timezone` is set").
export const updateMeProfileRequestSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  autoDetect: z.boolean().optional(),
  displayName: z.string().min(1).max(120).nullable().optional(),
  birthday: z.string().nullable().optional(),         // yyyy-mm-dd
  lifeExpectancyYears: z.number().int().positive().max(200).optional(),
});
export type UpdateMeProfileRequest = z.infer<typeof updateMeProfileRequestSchema>;
