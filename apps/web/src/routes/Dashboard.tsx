import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';
import { logout as apiLogout, logoutAll as apiLogoutAll } from '../lib/auth-api';
import { tokenStorage } from '../lib/token-storage';
import { useAuthStore } from '../stores/auth-store';

// Placeholder dashboard. Real widget layout will land with the Dashboard
// feature (Dashboard.md). For now this exists to:
//   1. Prove the JWT-guarded route + Bearer interceptor work end-to-end
//      (the /v1/health ping carries the Authorization header).
//   2. Give us a logout entry-point so we can exercise the full session
//      lifecycle from the UI before building Settings / Profile.

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const resetSession = useAuthStore((s) => s.resetSession);
  const [signOutScope, setSignOutScope] = useState<'this' | 'all'>('this');
  const [signingOut, setSigningOut] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  async function handleLogout(): Promise<void> {
    setSigningOut(true);
    try {
      if (signOutScope === 'all') {
        await apiLogoutAll();
      } else {
        const refresh = tokenStorage.getRefreshToken();
        if (refresh) await apiLogout(refresh);
      }
    } catch {
      // Best-effort: even if the server call fails (network, already-revoked),
      // wipe locally so the user isn't trapped in a half-authed state.
    } finally {
      resetSession();
      setSigningOut(false);
      void navigate({ to: '/login' });
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Focus Tracker</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Signed in as{' '}
            <span className="font-mono text-neutral-200">{user?.email ?? '(unknown)'}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={signingOut}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <label className="flex items-center gap-1.5 text-[0.7rem] text-neutral-400">
            <input
              type="checkbox"
              className="h-3 w-3 rounded border-neutral-600 bg-neutral-900"
              checked={signOutScope === 'all'}
              onChange={(e) => setSignOutScope(e.target.checked ? 'all' : 'this')}
            />
            Sign out everywhere
          </label>
        </div>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            API health
          </h2>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {isLoading && <p className="text-sm text-neutral-300">Pinging /v1/health…</p>}

        {isError && (
          <div className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
            <p className="font-medium">API unreachable</p>
            <p className="mt-1 text-red-300/80">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {data && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-neutral-400">status</dt>
            <dd className="font-mono text-emerald-400">{data.status}</dd>

            <dt className="text-neutral-400">apiVersion</dt>
            <dd className="font-mono text-neutral-200">{data.apiVersion}</dd>

            <dt className="text-neutral-400">uptime</dt>
            <dd className="font-mono text-neutral-200">{data.uptime}s</dd>

            <dt className="text-neutral-400">now</dt>
            <dd className="font-mono text-neutral-200">{data.now}</dd>
          </dl>
        )}
      </section>

      <footer className="text-xs text-neutral-500">
        Next: build the real Dashboard widgets (Dashboard.md).
      </footer>
    </main>
  );
}
