import { Link } from '@tanstack/react-router';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { ActiveSessionPanel } from '../focus/ActiveSessionPanel';
import { StartSessionForm } from '../focus/StartSessionForm';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — "Focus Session" (FocusSession.md §8.1).
//
// Two render branches, same card chrome:
//   - No active session: StartSessionForm (mode + duration + Start button)
//   - Active session: ActiveSessionPanel (live readout + pause/resume/stop)
//
// Shares the /v1/focus-sessions/current 5s poll with the /focus route and
// the slice-3 sticky bar via the useCurrentSession query key.

export function FocusSessionWidget() {
  const { data, isLoading, isError } = useCurrentSession();
  const session = data?.session ?? null;

  return (
    <section>
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Focus Session
          </h2>
          <WidgetReorderControls id="focus_session" />
        </div>
        <Link
          to="/focus"
          className="text-xs text-neutral-500 transition-colors hover:text-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open /focus →
        </Link>
      </header>

      {isLoading && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-500">
          Loading…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-300">
          Failed to load session.
        </div>
      )}
      {!isLoading && !isError && (session ? <ActiveSessionPanel session={session} /> : <StartSessionForm />)}
    </section>
  );
}
