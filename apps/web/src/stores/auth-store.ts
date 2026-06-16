import { create } from 'zustand';
import type { AuthUser } from '@focus-tracker/shared';
import { tokenStorage } from '../lib/token-storage';
import { isJwtValid } from '../lib/jwt';

// Tiny auth state per Auth.md §12.5. Deliberately does NOT hold the tokens
// themselves — those live in localStorage, single source of truth. The store
// only caches the `user` object so components don't have to refetch on
// every render, plus a derived `isAuthenticated` boolean.

const USER_KEY = 'ft.user';

function readPersistedUser(): AuthUser | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(USER_KEY) : null;
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function persistUser(user: AuthUser | null): void {
  if (typeof window === 'undefined') return;
  if (user === null) {
    localStorage.removeItem(USER_KEY);
  } else {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;

  /// Called after a successful /v1/auth/login. Persists tokens + user.
  setSession: (params: {
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
  }) => void;

  /// Wipe in-memory + persisted auth state. Does NOT call /v1/auth/logout —
  /// that's the caller's job (we want this method to be safe to call from
  /// the interceptor after a refresh failure, where calling logout would
  /// just 401 again).
  resetSession: () => void;
}

// Initial hydration: if a valid access token AND a persisted user object are
// both present on boot, treat as authenticated. If tokens exist but the
// user object is missing (e.g. cleared by hand), fall back to unauth — the
// next refresh round-trip will re-populate from /v1/me/profile (future).
const initialAccess = tokenStorage.getAccessToken();
const initialUser = readPersistedUser();
const initialIsAuth = isJwtValid(initialAccess) && initialUser !== null;

export const useAuthStore = create<AuthState>((set) => ({
  user: initialIsAuth ? initialUser : null,
  isAuthenticated: initialIsAuth,

  setSession({ accessToken, refreshToken, user }) {
    tokenStorage.setTokens({ accessToken, refreshToken });
    persistUser(user);
    set({ user, isAuthenticated: true });
  },

  resetSession() {
    tokenStorage.clear();
    persistUser(null);
    set({ user: null, isAuthenticated: false });
  },
}));
