// Auth contract shared by the API and the web app.
// Owner: Features Markdown/Auth.md §11.4 (response shapes) + §4 / §5.

import { z } from 'zod';

// ---------------------------------------------------------------------------
//  Common
// ---------------------------------------------------------------------------

/// Minimal user projection returned on login. Everything else lives on
/// `/v1/me/profile` (Settings.md §4.1).
export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/// Token pair returned on login / refresh.
export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.string().datetime(),
  refreshExpiresAt: z.string().datetime(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

// ---------------------------------------------------------------------------
//  Login (§4.1)
// ---------------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = authTokensSchema.extend({
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// ---------------------------------------------------------------------------
//  Refresh (§4.5)
// ---------------------------------------------------------------------------

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export type RefreshResponse = AuthTokens; // no `user` on refresh

// ---------------------------------------------------------------------------
//  Logout (§4.6)
// ---------------------------------------------------------------------------

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

// /v1/auth/logout-all takes no body.

// ---------------------------------------------------------------------------
//  Password change (§4.7)
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/// Password strength: NIST SP 800-63B rev. 4 — length matters, complexity
/// rules don't. The only enforced rules are length + non-whitespace.
/// `zxcvbn` is recommended for client-side UX only (Auth.md §7.2).
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'Password must be at least 8 characters.' })
  .max(PASSWORD_MAX_LENGTH, { message: 'Password is too long.' })
  .refine((s) => s.trim().length > 0, { message: 'Password cannot be whitespace.' });

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
  /// Defaults to true on the UI — see Auth.md §4.7. Required field; the API
  /// does not silently choose for the caller.
  signOutOtherDevices: z.boolean(),
  /// Identifies the device performing the change so it's NOT logged out when
  /// `signOutOtherDevices` is true.
  refreshToken: z.string().min(1).max(512),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// ---------------------------------------------------------------------------
//  Error codes (string union for client switch())
// ---------------------------------------------------------------------------

export const AUTH_ERROR_CODES = [
  'invalid_credentials', // POST /auth/login (constant-time, "no user" or "wrong pw")
  'refresh_invalid', // POST /auth/refresh (not found / revoked / expired — indistinct)
  'no_user_seeded', // POST /auth/login in dev mode when DB has no users
  'token_expired', // any JWT-guarded route with an expired access token
  'token_invalid', // any JWT-guarded route with a malformed/forged token
  'token_wrong_type', // JWT route hit with ft_live_ key (or vice versa)
  'current_password_wrong', // POST /me/password
  'weak_password', // POST /me/password — newPassword failed Zod
  'api_key_revoked', // future: ApiKey path
  'insufficient_scope', // future: ApiKey hits a JWT-only route
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
