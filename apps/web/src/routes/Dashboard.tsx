import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';

// Placeholder dashboard. Real widget layout will land with the Dashboard
// feature (Dashboard.md). For now this proves the JWT-guarded route + the
// Bearer interceptor work end-to-end — the /v1/health ping carries the
// Authorization header.
//
// Sign-out has moved to the AppShell header (so it's reachable from any
// route, not just /). Per Settings.md §4.1 the canonical home for sign-out
// is also Settings → Profile; both call the same code path.

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Placeholder until the real widgets land (Dashboard.md).
        </p>
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
    </main>
  );
}
