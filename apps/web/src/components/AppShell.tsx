import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTimezoneAutoDetect } from '../hooks/useTimezoneAutoDetect';
import { logout as apiLogout } from '../lib/auth-api';
import { StickySessionBar } from '../routes/focus/StickySessionBar';
import { backlogQueryKeys, listBacklog } from '../lib/tasks-api';
import { tokenStorage } from '../lib/token-storage';
import { fetchUiPrefs } from '../lib/ui-prefs-api';
import { hydrateLifeColors } from '../lib/life-colors';
import { hydrateLifeSize } from '../lib/life-size';
import { hydratePriorityColors } from '../routes/tasks/priority-colors';
import { hydratePriorityIcons } from '../routes/tasks/priority-icons';
import { useAuthStore } from '../stores/auth-store';

// The authenticated app shell. Wraps every protected route so users always
// have:
//   - A consistent nav (Dashboard / Tasks / Activity / Settings).
//   - A single "Sign out" control that logs out of THIS browser only.
//     The nuclear "Log out of all" variant lives in Settings → Profile
//     (Settings.md §4.1) — the day-to-day sign-out doesn't need to carry
//     the extra toggle.
//   - A future home for the cross-route sticky session bar
//     (FocusSession.md §8.3 — not implemented yet, placeholder noted in
//     the JSX comment).

export function AppShell(): ReactNode {
  // Silent backfill of the user's IANA timezone from the browser on every
  // authenticated session. See Settings.md §4.1.1 and useTimezoneAutoDetect
  // for the policy (no-op once `timezoneOverridden = true`).
  useTimezoneAutoDetect();
  // Pull cross-device cosmetic prefs once per authenticated mount. Stores
  // already painted from localStorage; this just reconciles with the server.
  useEffect(() => {
    fetchUiPrefs()
      .then((p) => {
        hydrateLifeColors(p.lifeColors);
        hydrateLifeSize(p.lifeSize);
        hydratePriorityColors(p.priorityColors);
        hydratePriorityIcons(p.priorityIcons);
      })
      .catch((err: unknown) => console.warn('[ui-prefs] GET failed; using local', err));
  }, []);
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen text-neutral-100">
      <AppHeader />
      {/* FocusSession.md §8.3 — self-suppresses on /focus and /login. */}
      <StickySessionBar currentPath={currentPath} />
      <Outlet />
    </div>
  );
}

function AppHeader() {
  const navigate = useNavigate();
  const resetSession = useAuthStore((s) => s.resetSession);
  const location = useRouterState({ select: (s) => s.location.pathname });

  const [signingOut, setSigningOut] = useState(false);

  // Lightweight unfiltered-count query. Shares the cache key with the
  // /backlog page so there's no duplicate request. Count comes from
  // the `summary` field which doesn't change even when the user's
  // priority filter narrows the `tasks` array — ideal for a nav badge.
  const backlogQuery = useQuery({
    queryKey: backlogQueryKeys.list(),
    queryFn: () => listBacklog(),
    staleTime: 30_000, // 30s — the backlog changes slowly
  });
  const backlogCount = backlogQuery.data
    ? backlogQuery.data.summary.extreme +
      backlogQuery.data.summary.high +
      backlogQuery.data.summary.mid +
      backlogQuery.data.summary.low
    : 0;

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      const refresh = tokenStorage.getRefreshToken();
      if (refresh) await apiLogout(refresh);
    } catch {
      // Best-effort — wipe locally even if the server call failed so the
      // user isn't trapped in a half-authed state.
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
            to="/life"
            label="Life"
            active={location === '/life' || location.startsWith('/life')}
          />
          <NavLink
            to="/calendar"
            label="Calendar"
            active={location === '/calendar' || location.startsWith('/calendar')}
          />
          <NavLink
            to="/tasks"
            label="Tasks"
            active={location === '/tasks' || location.startsWith('/tasks')}
          />
          <NavLink
            to="/backlog"
            label="Backlog"
            active={location === '/backlog' || location.startsWith('/backlog')}
            badge={backlogCount > 0 ? backlogCount : undefined}
          />
          <NavLink
            to="/focus"
            label="Focus"
            active={location === '/focus' || location.startsWith('/focus')}
          />
          <NavLink
            to="/settings"
            label="Settings"
            active={location === '/settings' || location.startsWith('/settings')}
          />
        </nav>

        {/* Mobile: the nav fills the header, so Sign out moves to Settings. */}
        <div className="ml-auto hidden shrink-0 items-center gap-3 md:flex">
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
  to: '/' | '/tasks' | '/backlog' | '/focus' | '/activity' | '/life' | '/calendar' | '/settings';
  label: string;
  active: boolean;
  /// Optional count pill next to the label. Hidden when undefined / 0.
  badge?: number;
}

function NavLink({ to, label, active, badge }: NavLinkProps) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
        active
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1 text-[0.65rem] font-semibold text-amber-300"
          aria-label={`${badge} in backlog`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
