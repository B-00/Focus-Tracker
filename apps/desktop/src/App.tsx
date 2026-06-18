import { useQuery } from '@tanstack/react-query';
import { getState, type DesktopState } from './lib/tauri';
import { Unpaired } from './routes/Unpaired';
import { Paired } from './routes/Paired';

// State machine for the settings window:
//
//   loading → (state.paired == false) → Unpaired   ─┐
//           → (state.paired == true)  → Paired      │
//           → (error)                 → ErrorScreen │
//                                                   │
//   Pairing is a *substate* of Unpaired (the React route owns the
//   start-pairing / poll-pairing loop; transitions to Paired happen by
//   re-querying ['desktop-state'] after the Rust side commits the key).

export function App() {
  const { data, isLoading, isError, error, refetch } = useQuery<DesktopState>({
    queryKey: ['desktop-state'],
    queryFn: getState,
  });

  return (
    <main className="flex h-full w-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-sm font-semibold tracking-tight">Focus Tracker</span>
        </div>
        {data && (
          <span
            className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider ${
              data.paired
                ? 'bg-emerald-950/60 text-emerald-300 ring-1 ring-emerald-900/60'
                : 'bg-amber-950/60 text-amber-300 ring-1 ring-amber-900/60'
            }`}
          >
            {data.paired ? 'Paired' : 'Not paired'}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <LoadingState />}
        {isError && <ErrorState message={error.message} onRetry={() => void refetch()} />}
        {data && !data.paired && <Unpaired state={data} />}
        {data && data.paired && <Paired state={data} />}
      </div>
    </main>
  );
}

function Logo() {
  // Placeholder mark — we have a real icon set in src-tauri/icons/ for the
  // window/tray; this is just for the in-app header.
  return (
    <div
      aria-hidden
      className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-500/20 text-[0.65rem] font-bold text-accent-500"
    >
      FT
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-400">
      Loading…
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium text-red-300">Couldn't load desktop state.</p>
      <p className="text-xs text-neutral-400" data-selectable>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800"
      >
        Retry
      </button>
    </div>
  );
}
