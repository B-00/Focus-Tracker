import { useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { logout as apiLogout, logoutAll as apiLogoutAll } from '../lib/auth-api';
import { tokenStorage } from '../lib/token-storage';
import { useAuthStore } from '../stores/auth-store';

// The authenticated app shell. Wraps every protected route so users always
// have:
//   - A consistent nav (Dashboard / Settings) on every screen.
//   - The sign-out control + "Sign out everywhere" toggle in one canonical
//     place — Settings.md §4.1 makes Profile the home for logout, but the
//     shell still surfaces it so people don't have to dig into Settings
//     just to sign out. (Both points end up calling the same code path.)
//   - A future home for the cross-route sticky session bar
//     (FocusSession.md §8.3 — not implemented yet, placeholder noted in
//     the JSX comment).

export function AppShell(): ReactNode {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="min-h-screen text-neutral-100">
      <AppHeader email={user?.email ?? null} />
      {/* TODO(FocusSession §8.3): cross-route sticky session bar mounts here */}
      <Outlet />
    </div>
  );
}

interface AppHeaderProps {
  email: string | null;
}

function AppHeader({ email }: AppHeaderProps) {
  const navigate = useNavigate();
  const resetSession = useAuthStore((s) => s.resetSession);
  const location = useRouterState({ select: (s) => s.location.pathname });

  const [signOutScope, setSignOutScope] = useState<'this' | 'all'>('this');
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      if (signOutScope === 'all') {
        await apiLogoutAll();
      } else {
        const refresh = tokenStorage.getRefreshToken();
        if (refresh) await apiLogout(refresh);
      }
    } catch {
      // Best-effort — wipe locally even if the server call failed so the
      // user isn't trapped in a half-authed state. (Same posture as the
      // original Dashboard sign-out path.)
    } finally {
      resetSession();
      setSigningOut(false);
      void navigate({ to: '/login' });
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-4 px-4">
        <Link
          to="/"
          className="text-sm font-semibold tracking-tight text-neutral-100 hover:text-white"
        >
          Focus Tracker
        </Link>

        <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
          <NavLink to="/" label="Dashboard" active={location === '/'} />
          <NavLink
            to="/activity"
            label="Activity"
            active={location === '/activity' || location.startsWith('/activity')}
          />
          <NavLink
            to="/settings"
            label="Settings"
            active={location === '/settings' || location.startsWith('/settings')}
          />
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {email && (
            <span className="hidden truncate text-xs text-neutral-400 sm:inline">
              {email}
            </span>
          )}
          <label className="hidden items-center gap-1.5 text-[0.7rem] text-neutral-400 sm:flex">
            <input
              type="checkbox"
              className="h-3 w-3 rounded border-neutral-600 bg-neutral-900"
              checked={signOutScope === 'all'}
              onChange={(e) => setSignOutScope(e.target.checked ? 'all' : 'this')}
            />
            Everywhere
          </label>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </header>
  );
}

interface NavLinkProps {
  to: '/' | '/activity' | '/settings';
  label: string;
  active: boolean;
}

function NavLink({ to, label, active }: NavLinkProps) {
  return (
    <Link
      to={to}
      className={`rounded-md px-2.5 py-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
        active
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      {label}
    </Link>
  );
}
