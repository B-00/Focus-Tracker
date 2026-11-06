import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  effectiveMs,
  sumPauseMs,
  type FocusSessionLatestTarget,
  type FocusSessionResponse,
} from '@focus-tracker/shared';
import { useNowMs } from '../../hooks/useCurrentSession';
import {
  focusSessionsQueryKeys,
  pauseSession,
  resumeSession,
  stopSession,
} from '../../lib/focus-sessions-api';
import { formatDuration } from '../../lib/format-duration';

// Rendered when the user has an active (running or paused) session —
// from the dashboard widget, the /focus route top panel, and (slice 3)
// the cross-route sticky bar.
//
// Owns:
//   - Live elapsed-time readout (ticks 1Hz via useNowMs)
//   - Remaining time + progress bar when mode = 'timer'
//   - Pause / Resume / Stop controls
//
// ponytail: "current target" bullet (§8.1) — the latest attributed telemetry
// event — is deferred to slice 3. Needs a new GET on top of /current to look
// up the most recent `TelemetryEvent WHERE focusSessionId = :id`, and that
// endpoint doesn't exist yet. The panel is fully usable without it.

export function ActiveSessionPanel({
  session,
  latestTarget = null,
  compact = false,
}: {
  session: FocusSessionResponse;
  /// Most recent attributed telemetry event's target — populated by the
  /// /current poll (§8.1). Null while there's been no attributed activity
  /// yet, or when the field is unavailable.
  latestTarget?: FocusSessionLatestTarget | null;
  /// Dense single-row variant for the (future) sticky bar. Hides the big
  /// readout and renders inline. Slice 2 doesn't use this but it keeps
  /// slice 3 cheap.
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const now = useNowMs();
  const nowDate = new Date(now);

  const isRunning = session.state === 'running';
  const isPaused = session.state === 'paused';

  // Derived live values. Pause arithmetic lives in @focus-tracker/shared so
  // the server and client can't disagree.
  const effMs = effectiveMs(session, nowDate);
  const pausedTotalMs = sumPauseMs(session.pauses, nowDate);
  const remainingMs =
    session.plannedDurationMs != null
      ? Math.max(0, session.plannedDurationMs - effMs)
      : null;
  const progressPct =
    session.plannedDurationMs != null
      ? Math.min(100, (effMs / session.plannedDurationMs) * 100)
      : null;

  const pause = useMutation({
    mutationFn: () => pauseSession(session.id),
    onSuccess: () => invalidate(qc),
  });
  const resume = useMutation({
    mutationFn: () => resumeSession(session.id),
    onSuccess: () => invalidate(qc),
  });
  const stop = useMutation({
    mutationFn: () => stopSession(session.id),
    onSuccess: () => invalidate(qc),
  });
  const busy = pause.isPending || resume.isPending || stop.isPending;

  const statusLabel = isPaused ? '❚❚ paused' : '● running';
  const statusColor = isPaused
    ? 'border-amber-500/40 bg-amber-500/5 text-amber-200'
    : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200';

  return (
    <section className={`rounded-lg border p-5 ${statusColor}`}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
          <span>{statusLabel}</span>
          <span className="text-neutral-400/80">
            {session.mode === 'timer' ? 'timer' : 'open'}
          </span>
        </div>
        {session.pauses.length > 0 && (
          <span className="text-xs text-neutral-400">
            {session.pauses.length} pause{session.pauses.length === 1 ? '' : 's'}
            {' · '}
            {formatDuration(pausedTotalMs)} paused
          </span>
        )}
      </header>

      {!compact && (
        <div className="mb-4 flex items-baseline justify-between">
          {/* Big elapsed readout — mm:ss when under an hour, h:mm:ss otherwise */}
          <div>
            <div
              className="text-5xl font-semibold tabular-nums tracking-tight text-neutral-50"
              aria-live="polite"
              aria-atomic="true"
            >
              {formatClock(effMs)}
            </div>
            <div className="mt-1 text-xs text-neutral-400">effective</div>
          </div>
          {remainingMs !== null && (
            <div className="text-right">
              <div className="text-xl font-medium tabular-nums text-neutral-200">
                {formatClock(remainingMs)}
              </div>
              <div className="mt-1 text-xs text-neutral-400">remaining</div>
            </div>
          )}
        </div>
      )}

      {progressPct !== null && !compact && (
        <div
          className="mb-4 h-1.5 w-full overflow-hidden rounded bg-neutral-900"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
        >
          <div
            className={`h-full transition-all ${isPaused ? 'bg-amber-500/60' : 'bg-emerald-500/80'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {latestTarget && !compact && (
        <p className="mb-3 truncate text-xs text-neutral-400" aria-live="polite">
          <span className="text-neutral-500">now · </span>
          <span className="text-neutral-200">{latestTarget.name}</span>
          <span className="ml-1.5 text-[0.65rem] uppercase tracking-wider text-neutral-500">
            {latestTarget.source}
          </span>
        </p>
      )}

      <div className="flex items-center gap-2">
        {isRunning && (
          <button
            type="button"
            onClick={() => pause.mutate()}
            disabled={busy}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
          >
            Pause
          </button>
        )}
        {isPaused && (
          <button
            type="button"
            onClick={() => resume.mutate()}
            disabled={busy}
            className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={() => stop.mutate()}
          disabled={busy}
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-50"
        >
          Stop
        </button>
      </div>
    </section>
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.current() });
  void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.list() });
}

/// hh:mm:ss / mm:ss. Monospace-digits-friendly. Used only for the live
/// readout; historical summaries use formatDuration() for shorter strings.
function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
