import type { LoginRequest, LoginResponse } from '@focus-tracker/shared';
import { api } from './api';

// Typed thin wrappers around the /v1/auth/* endpoints. Pure transport — no
// store mutations or token persistence here. Callers (the Login route, the
// refresh interceptor, the logout button) own that side-effect.

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/v1/auth/login', payload);
  return data;
}

// NOTE: the refresh round-trip is performed INSIDE `lib/api.ts`'s response
// interceptor (Auth.md §12.3) — it bypasses the `api` instance to avoid
// recursive 401-handling. There's no separate public `refresh()` helper.

/// Server-side revoke of THIS device's refresh token. Idempotent — safe to
/// call even if the token is already revoked.
export async function logout(refreshToken: string): Promise<void> {
  await api.post('/v1/auth/logout', { refreshToken });
}

export async function logoutAll(): Promise<void> {
  await api.post('/v1/auth/logout-all');
}
