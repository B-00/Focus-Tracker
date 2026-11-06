import { useCurrentSession } from '../hooks/useCurrentSession';
import { ActiveSessionPanel } from './focus/ActiveSessionPanel';
import { SessionHistoryList } from './focus/SessionHistoryList';
import { StartSessionForm } from './focus/StartSessionForm';

// /focus route — FocusSession.md §8.2.
//
// Top: active-session controls OR start form (same primitives as the
// dashboard widget). Bottom: session history list.

export function FocusPage() {
  const { data, isLoading, isError } = useCurrentSession();
  const session = data?.session ?? null;

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Focus</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Start a timer-bound or open session; past sessions appear below.
        </p>
      </header>

      {isLoading && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-500">
          Loading…
        </section>
      )}
      {isError && (
        <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-300">
          Failed to load current session.
        </section>
      )}
      {!isLoading && !isError && (session ? <ActiveSessionPanel session={session} /> : <StartSessionForm />)}

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
          History
        </h2>
        <SessionHistoryList />
      </section>
    </main>
  );
}
