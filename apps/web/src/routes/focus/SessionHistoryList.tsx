import { useQuery } from '@tanstack/react-query';
import type { FocusSessionListItem } from '@focus-tracker/shared';
import {
  focusSessionsQueryKeys,
  listSessions,
} from '../../lib/focus-sessions-api';
import { formatDuration } from '../../lib/format-duration';

// Session history — FocusSession.md §8.2, bottom section. Reverse-chron
// list, compact rows: date · effective · pauses · end-reason badge.
//
// ponytail: inline expand / detail drawer (§8.2 "click to expand the
// post-session summary") is deferred to slice 3 where the /breakdown
// endpoint lands. For slice 2 the list is read-only.

const PAGE_LIMIT = 100;

export function SessionHistoryList() {
  const query = { limit: PAGE_LIMIT } as const;
  const { data, isLoading, isError } = useQuery({
    queryKey: focusSessionsQueryKeys.list(query),
    queryFn: () => listSessions(query),
  });

  if (isLoading) {
    return <p className="text-sm text-neutral-500">Loading history…</p>;
  }
  if (isError) {
    return <p className="text-sm text-red-300">Failed to load session history.</p>;
  }
  const sessions = data?.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No sessions yet. Start one above and it'll show up here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} />
      ))}
    </ul>
  );
}

function SessionRow({ session }: { session: FocusSessionListItem }) {
  const started = new Date(session.startedAt);
  const dateLabel = started.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const effLabel =
    session.effectiveDurationMs != null
      ? formatDuration(session.effectiveDurationMs)
      : '—';
  const endReason = session.endReason ?? session.state;

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="tabular-nums text-neutral-200">{dateLabel}</span>
        <span className="text-xs uppercase tracking-wider text-neutral-500">
          {session.mode}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="tabular-nums text-neutral-300">{effLabel}</span>
        {session.pauseCount > 0 && (
          <span className="text-neutral-500">
            {session.pauseCount}p · {formatDuration(session.pauseTotalMs)}
          </span>
        )}
        <EndReasonBadge reason={endReason} />
      </div>
    </li>
  );
}

function EndReasonBadge({ reason }: { reason: string }) {
  const map: Record<string, string> = {
    timer_complete: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    manual_stop: 'border-neutral-700 bg-neutral-900 text-neutral-300',
    aborted: 'border-red-500/40 bg-red-500/10 text-red-200',
    running: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    paused: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    completed: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  };
  const cls = map[reason] ?? 'border-neutral-700 bg-neutral-900 text-neutral-300';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider ${cls}`}>
      {reason.replace(/_/g, ' ')}
    </span>
  );
}
