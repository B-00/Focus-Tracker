// Typed wrappers over localStorage for the two auth tokens.
//
// Auth.md §4.2 — both tokens live in localStorage; refresh tokens are NEVER
// sent as cookies. The only path to use a refresh is the explicit
// `/v1/auth/refresh` call from the Axios interceptor (§12.3).
//
// This module is the SINGLE place we touch `localStorage` for tokens — so
// changing the storage backend (e.g. moving to IndexedDB or adding
// encryption) is a one-file change.

const ACCESS_KEY = 'ft.accessToken';
const REFRESH_KEY = 'ft.refreshToken';

/// `localStorage` is unavailable during SSR and in some sandboxed contexts;
/// fall back to a no-op so the rest of the app doesn't blow up.
function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const tokenStorage = {
  getAccessToken(): string | null {
    return safeStorage()?.getItem(ACCESS_KEY) ?? null;
  },
  getRefreshToken(): string | null {
    return safeStorage()?.getItem(REFRESH_KEY) ?? null;
  },
  setTokens(tokens: { accessToken: string; refreshToken: string }): void {
    const s = safeStorage();
    if (!s) return;
    s.setItem(ACCESS_KEY, tokens.accessToken);
    s.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    const s = safeStorage();
    if (!s) return;
    s.removeItem(ACCESS_KEY);
    s.removeItem(REFRESH_KEY);
  },
} as const;
