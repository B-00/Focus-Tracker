import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { effectiveMs, isActiveState } from '@focus-tracker/shared';
import { useCurrentSession, useNowMs } from '../../hooks/useCurrentSession';
import {
  focusSessionsQueryKeys,
  pauseSession,
  resumeSession,
  stopSession,
} from '../../lib/focus-sessions-api';

// Cross-route sticky session bar — FocusSession.md §8.3.
//
// Mounted in AppShell; renders only when there's an active (running|paused)
// session AND the current route isn't suppressing it (see shouldShowOn()
// below). Click anywhere outside the controls → navigates to /focus.
//
// Shares the same /v1/focus-sessions/current 5s poll as the dashboard
// widget + /focus page via the shared TanStack Query key, so mounting
// the bar everywhere is still one network request per 5s.
//
// ponytail: toast on session-end deferred — AppShell auto-dismisses when
// the bar disappears, and both the dashboard widget and /focus page
// auto-open the summary modal when the user is on those surfaces. User
// who's on /tasks when a timer fires loses the "jump to summary" shortcut;
// they can just hit /focus. Upgrade path: sonner or a one-off toast
// provider if this bites.

export function StickySessionBar({ currentPath }: { currentPath: string }) {
  const qc = useQueryClient();
  const { data } = useCurrentSession();
  const session = data?.session ?? null;
  const now = useNowMs();

  const pause = useMutation({
    mutationFn: (id: string) => pauseSession(id),
    onSuccess: () => invalidate(qc),
  });
  const resume = useMutation({
    mutationFn: (id: string) => resumeSession(id),
    onSuccess: () => invalidate(qc),
  });
  const stop = useMutation({
    mutationFn: (id: string) => stopSession(id),
    onSuccess: () => invalidate(qc),
  });

  if (!session || !isActiveState(session.state)) return null;
  if (!shouldShowOn(currentPath)) return null;

  const isPaused = session.state === 'paused';
  const effMs = effectiveMs(session, new Date(now));
  const busy = pause.isPending || resume.isPending || stop.isPending;

  const barClass = isPaused
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';

  return (
    <div
      className={`sticky top-12 z-20 border-b backdrop-blur ${barClass}`}
      role="region"
      aria-label="Active focus session"
    >
      <div className="mx-auto flex h-9 max-w-5xl items-center gap-3 px-4 text-xs">
        {/* Click-target outside the controls → /focus */}
        <Link
          to="/focus"
          className="flex min-w-0 flex-1 items-center gap-3 focus:outline-none"
        >
          <span className="font-medium uppercase tracking-wider">
            {isPaused ? '❚❚ paused' : '● running'}
          </span>
          <span className="tabular-nums">{formatClock(effMs)}</span>
          {session.plannedDurationMs != null && (
            <span className="text-[0.65rem] opacity-70">
              / {formatClock(session.plannedDurationMs)}
            </span>
          )}
        </Link>

        <div className="flex items-center gap-1.5">
          {!isPaused && (
            <BarButton onClick={() => pause.mutate(session.id)} disabled={busy}>
              Pause
            </BarButton>
          )}
          {isPaused && (
            <BarButton
              onClick={() => resume.mutate(session.id)}
              disabled={busy}
              emphasise
            >
              Resume
            </BarButton>
          )}
          <BarButton
            onClick={() => stop.mutate(session.id)}
            disabled={busy}
            tone="danger"
          >
            Stop
          </BarButton>
        </div>
      </div>
    </div>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
  tone = 'default',
  emphasise = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  emphasise?: boolean;
}) {
  const base =
    'rounded border px-2 py-0.5 text-[0.7rem] transition disabled:opacity-50';
  const styles =
    tone === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20'
      : emphasise
        ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
        : 'border-neutral-700 bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.current() });
  void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.list() });
}

/// §8.3: suppressed on `/focus` (covered by the page itself) and `/login`
/// (not authenticated). Not suppressed on `/` — minor redundancy with the
/// dashboard widget accepted to keep the rule simple.
function shouldShowOn(path: string): boolean {
  if (path === '/focus' || path.startsWith('/focus/')) return false;
  if (path === '/login' || path.startsWith('/login')) return false;
  return true;
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
