import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { AuthTokens, HealthResponse } from '@focus-tracker/shared';
import { tokenStorage } from './token-storage';

// Single shared Axios instance. Base URL is empty in dev so requests go to
// relative `/v1/...` and Vite's proxy forwards to http://localhost:3000.
// Set VITE_API_BASE_URL at build time for prod.
const baseURL = import.meta.env.VITE_API_BASE_URL ?? '';

export const api = axios.create({
  baseURL,
  withCredentials: false,
  headers: { 'Content-Type': 'application/json' },
});

// ---------------------------------------------------------------------------
//  Request interceptor — attach Bearer header (Auth.md §12.2)
// ---------------------------------------------------------------------------

api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// ---------------------------------------------------------------------------
//  Response interceptor — refresh-on-401 with in-flight queue (Auth.md §12.3)
// ---------------------------------------------------------------------------
//
// The first request that observes `401 token_expired` kicks off a single
// `/v1/auth/refresh` call. Every concurrent request that also 401s while
// that refresh is in flight awaits the same promise — no thundering herd of
// rotation attempts that would race to invalidate each other's refresh token.

let refreshInFlight: Promise<AuthTokens> | null = null;

/// Hook the route layer wires up at boot. When the interceptor decides the
/// session is unrecoverable, it calls this — the router then clears the
/// auth store and navigates to /login. Wiring lives outside the axios layer
/// so this module stays UI-agnostic.
let onSessionInvalid: (() => void) | null = null;
export function registerSessionInvalidHandler(handler: () => void): void {
  onSessionInvalid = handler;
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  _ftRetried?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: string }>) => {
    const original = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.error;

    // Only intervene on auth failures we can fix transparently.
    // - Must be 401
    // - With either `token_expired` or `token_invalid` (server rejected the JWT)
    // - Must not already have been retried (no infinite loops)
    // - Must not be the refresh endpoint itself (refresh failures are terminal)
    const isAuthFailure =
      status === 401 && (code === 'token_expired' || code === 'token_invalid');
    const isRefreshCall = original?.url?.includes('/v1/auth/refresh') ?? false;

    if (!original || !isAuthFailure || original._ftRetried || isRefreshCall) {
      return Promise.reject(error);
    }

    const storedRefresh = tokenStorage.getRefreshToken();
    if (!storedRefresh) {
      // No way to recover — caller / route guard will redirect to /login.
      onSessionInvalid?.();
      return Promise.reject(error);
    }

    try {
      const tokens = await acquireRefresh(storedRefresh);
      original._ftRetried = true;
      original.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
      return api.request(original);
    } catch (refreshErr) {
      // Refresh failed (invalid / revoked / expired) — terminal. Wipe and
      // bounce to login.
      tokenStorage.clear();
      onSessionInvalid?.();
      return Promise.reject(refreshErr);
    }
  },
);

/// De-duplicates concurrent refresh attempts. The first caller starts the
/// network round-trip; subsequent callers `await` the same promise.
async function acquireRefresh(refreshToken: string): Promise<AuthTokens> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      // Inline call so this module has zero dependency on auth-api.ts (which
      // imports this one — avoid the cycle).
      const { data } = await axios.post<AuthTokens>(
        `${baseURL}/v1/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      tokenStorage.setTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return data;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
//  Misc transport helpers (kept here for backwards compatibility — health
//  was the only previous caller and the App component still uses it).
// ---------------------------------------------------------------------------

export async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/v1/health');
  return data;
}

// Re-exported for tests / explicit non-intercepted calls.
export type { AxiosRequestConfig };
