import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  useCurrentSession,
  useSessionEnded,
} from '../../hooks/useCurrentSession';
import { ActiveSessionPanel } from '../focus/ActiveSessionPanel';
import { SessionSummaryModal } from '../focus/SessionSummaryModal';
import { StartSessionForm } from '../focus/StartSessionForm';
import { useWidgetCollapsed } from './widget-collapse';
import { WidgetCollapseToggle } from './WidgetCollapseToggle';
import { WidgetDragHandle } from './SortableWidget';

const BODY_ID = 'widget-focus-session-body';

// Dashboard widget — "Focus Session" (FocusSession.md §8.1).
//
// Two render branches, same card chrome:
//   - No active session: StartSessionForm (mode + duration + Start button)
//   - Active session: ActiveSessionPanel (live readout + pause/resume/stop)
//
// Shares the /v1/focus-sessions/current 5s poll with the /focus route and
// the slice-3 sticky bar via the useCurrentSession query key.

export function FocusSessionWidget() {
  // ponytail: useCurrentSession kept active even when collapsed — the
  // sticky bar in AppShell shares this query key and relies on the poll.
  // Also keeps useSessionEnded live so the post-session summary still
  // pops if the user folded the card up mid-session.
  const { data, isLoading, isError } = useCurrentSession();
  const session = data?.session ?? null;
  const collapsed = useWidgetCollapsed('focus_session');

  // Pop the post-session summary the moment the current session transitions
  // to completed (user-initiated Stop or scheduler timer_complete). §8.4.
  const [summaryId, setSummaryId] = useState<string | null>(null);
  useSessionEnded((id) => setSummaryId(id));

  return (
    <section>
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Focus Session
          </h2>
          <WidgetDragHandle />
          <WidgetCollapseToggle id="focus_session" controlsId={BODY_ID} />
        </div>
        <Link
          to="/focus"
          className="text-xs text-neutral-500 transition-colors hover:text-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open /focus →
        </Link>
      </header>

      {!collapsed && (
        <div id={BODY_ID}>
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
          {!isLoading && !isError && (
            session
              ? <ActiveSessionPanel session={session} latestTarget={data?.latestTarget ?? null} />
              : <StartSessionForm />
          )}
        </div>
      )}

      <SessionSummaryModal
        sessionId={summaryId}
        open={summaryId !== null}
        onClose={() => setSummaryId(null)}
      />
    </section>
  );
}
