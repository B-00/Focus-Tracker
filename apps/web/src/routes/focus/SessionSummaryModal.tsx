import { useQuery } from '@tanstack/react-query';
import type {
  FocusSessionBreakdownResponse,
  FocusSessionBreakdownRow,
  FocusSessionResponse,
} from '@focus-tracker/shared';
import { Modal } from '../../components/Modal';
import {
  fetchSession,
  fetchSessionBreakdown,
  focusSessionsQueryKeys,
} from '../../lib/focus-sessions-api';
import { formatDuration } from '../../lib/format-duration';

// Post-session summary — FocusSession.md §8.4.
//
// Opens automatically when a session transitions to `completed`
// (the wiring lives in FocusSessionWidget / FocusPage, which react to
// the useCurrentSession poll going from non-null to null). Also reachable
// later by clicking a row in SessionHistoryList.
//
// Contents per spec:
//   * Header — start/end/effective/wall-clock/pause count
//   * Pause timeline — horizontal bar, shaded segments per pause
//   * Pause breakdown text
//   * Top apps / top sites (from /breakdown)
//   * Linked task — v1 omits (no task picker until slice 4 ships it)
//
// ponytail: no quality rating, no notes input — v1 minimal (§8.4).
// Linked-task "Mark complete" affordance deferred until the task picker
// in StartSessionForm ships.

export function SessionSummaryModal({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const sessionQuery = useQuery({
    queryKey: sessionId ? focusSessionsQueryKeys.detail(sessionId) : ['focus-sessions', 'detail', 'none'],
    queryFn: () => (sessionId ? fetchSession(sessionId) : Promise.reject(new Error('no id'))),
    enabled: open && sessionId !== null,
    staleTime: 60_000,
  });
  const breakdownQuery = useQuery({
    queryKey: sessionId ? focusSessionsQueryKeys.breakdown(sessionId) : ['focus-sessions', 'breakdown', 'none'],
    queryFn: () => (sessionId ? fetchSessionBreakdown(sessionId) : Promise.reject(new Error('no id'))),
    enabled: open && sessionId !== null,
    staleTime: 60_000,
  });

  const session = sessionQuery.data;
  const breakdown = breakdownQuery.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={session ? summaryTitle(session) : 'Session summary'}
      description={session ? summaryDescription(session) : undefined}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Close
        </button>
      }
    >
      {sessionQuery.isLoading && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
      {sessionQuery.isError && (
        <p className="text-sm text-red-300">Failed to load session.</p>
      )}
      {session && (
        <div className="flex flex-col gap-5">
          <StatsGrid session={session} />
          <PauseTimeline session={session} />
          <BreakdownPanel
            kind="apps"
            breakdown={breakdown}
            loading={breakdownQuery.isLoading}
            error={breakdownQuery.isError}
          />
          <BreakdownPanel
            kind="sites"
            breakdown={breakdown}
            loading={breakdownQuery.isLoading}
            error={breakdownQuery.isError}
          />
        </div>
      )}
    </Modal>
  );
}

function summaryTitle(s: FocusSessionResponse): string {
  if (s.endReason === 'timer_complete') return 'Timer complete';
  if (s.endReason === 'manual_stop') return 'Session ended';
  if (s.endReason === 'aborted') return 'Session auto-ended';
  return 'Session summary';
}

function summaryDescription(s: FocusSessionResponse): string {
  const started = new Date(s.startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${s.mode === 'timer' ? 'Timer' : 'Open'} session · started ${started}`;
}

function StatsGrid({ session }: { session: FocusSessionResponse }) {
  const startedMs = Date.parse(session.startedAt);
  const endedMs = session.endedAt ? Date.parse(session.endedAt) : Date.now();
  const wallClockMs = Math.max(0, endedMs - startedMs);
  const pauseTotalMs = session.pauses.reduce(
    (acc, p) => acc + (p.durationMs ?? 0),
    0,
  );
  const effectiveMs = session.effectiveDurationMs ?? Math.max(0, wallClockMs - pauseTotalMs);

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      <Stat label="Effective" value={formatDuration(effectiveMs)} emphasise />
      <Stat label="Wall-clock" value={formatDuration(wallClockMs)} />
      <Stat label="Pauses" value={`${session.pauses.length}`} />
      <Stat label="Paused" value={formatDuration(pauseTotalMs)} />
    </dl>
  );
}

function Stat({
  label,
  value,
  emphasise = false,
}: {
  label: string;
  value: string;
  emphasise?: boolean;
}) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 tabular-nums ${
          emphasise ? 'text-xl font-semibold text-neutral-100' : 'text-neutral-200'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function PauseTimeline({ session }: { session: FocusSessionResponse }) {
  if (session.pauses.length === 0) {
    return (
      <p className="text-xs text-neutral-500">No pauses during this session.</p>
    );
  }
  const startedMs = Date.parse(session.startedAt);
  const endedMs = session.endedAt ? Date.parse(session.endedAt) : Date.now();
  const totalMs = Math.max(1, endedMs - startedMs);

  return (
    <div>
      <h3 className="mb-1.5 text-[0.65rem] uppercase tracking-wider text-neutral-500">
        Pause timeline
      </h3>
      <div
        className="relative h-3 w-full overflow-hidden rounded bg-emerald-500/20"
        role="img"
        aria-label={`${session.pauses.length} pause${session.pauses.length === 1 ? '' : 's'} across the session`}
      >
        {session.pauses.map((p) => {
          const pauseStart = Date.parse(p.pausedAt);
          const pauseEnd = p.resumedAt ? Date.parse(p.resumedAt) : endedMs;
          const leftPct = ((pauseStart - startedMs) / totalMs) * 100;
          const widthPct = Math.max(
            0.5,
            ((pauseEnd - pauseStart) / totalMs) * 100,
          );
          return (
            <div
              key={p.id}
              className="absolute top-0 h-full bg-amber-500/80"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`Paused ${formatDuration(pauseEnd - pauseStart)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function BreakdownPanel({
  kind,
  breakdown,
  loading,
  error,
}: {
  kind: 'apps' | 'sites';
  breakdown: FocusSessionBreakdownResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  const label = kind === 'apps' ? 'Top apps' : 'Top sites';
  const sourceLabel = kind === 'apps' ? 'desktop' : 'browser';

  if (loading) {
    return (
      <PanelShell label={label} sourceLabel={sourceLabel}>
        <p className="text-sm text-neutral-500">Loading…</p>
      </PanelShell>
    );
  }
  if (error) {
    return (
      <PanelShell label={label} sourceLabel={sourceLabel}>
        <p className="text-sm text-red-300">Failed to load breakdown.</p>
      </PanelShell>
    );
  }
  if (!breakdown) return null;

  const rows = kind === 'apps' ? breakdown.topApps : breakdown.topSites;
  const totalMs = kind === 'apps' ? breakdown.totalAppsMs : breakdown.totalSitesMs;
  if (rows.length === 0) {
    return (
      <PanelShell label={label} sourceLabel={sourceLabel}>
        <p className="text-sm text-neutral-500">
          No {sourceLabel} activity attributed.
        </p>
      </PanelShell>
    );
  }
  const topSum = rows.reduce((acc, r) => acc + r.durationMs, 0);
  const otherMs = Math.max(0, totalMs - topSum);

  return (
    <PanelShell label={label} sourceLabel={sourceLabel}>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <BreakdownRow key={row.name} row={row} totalMs={totalMs} />
        ))}
        {otherMs > 0 && (
          <BreakdownRow
            row={{ name: 'Other', durationMs: otherMs }}
            totalMs={totalMs}
            muted
          />
        )}
      </ul>
    </PanelShell>
  );
}

function PanelShell({
  label,
  sourceLabel,
  children,
}: {
  label: string;
  sourceLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
          {label}
        </h3>
        <span className="text-[0.6rem] text-neutral-600">{sourceLabel}</span>
      </header>
      {children}
    </div>
  );
}

function BreakdownRow({
  row,
  totalMs,
  muted = false,
}: {
  row: FocusSessionBreakdownRow;
  totalMs: number;
  muted?: boolean;
}) {
  const sharePct = totalMs > 0 ? (row.durationMs / totalMs) * 100 : 0;
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
      <div className="min-w-0">
        <div className="mb-0.5 flex items-baseline justify-between gap-2">
          <span className={`truncate ${muted ? 'text-neutral-500' : 'text-neutral-200'}`}>
            {row.name}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-900">
          <div
            className={muted ? 'h-full bg-neutral-700' : 'h-full bg-emerald-500/80'}
            style={{ width: `${sharePct}%` }}
          />
        </div>
      </div>
      <span className="tabular-nums text-xs text-neutral-300">
        {formatDuration(row.durationMs)}
      </span>
    </li>
  );
}
