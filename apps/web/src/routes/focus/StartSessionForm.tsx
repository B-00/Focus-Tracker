import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StartFocusSessionRequest, TaskResponse } from '@focus-tracker/shared';
import {
  focusSessionsQueryKeys,
  SessionAlreadyActiveError,
  startSession,
  stopSession,
} from '../../lib/focus-sessions-api';
import { Modal } from '../../components/Modal';
import { formatDuration } from '../../lib/format-duration';
import { listTasks, tasksQueryKeys } from '../../lib/tasks-api';

// Shared "Start Session" form used by the dashboard widget AND the /focus
// route (FocusSession.md §8.1 / §8.2). Owns:
//   - Mode toggle (timer / open)
//   - Duration presets (25m / 50m / 90m / custom) — only visible in timer mode
//   - Optional task picker (dropdown of incomplete tasks)
//   - POST /v1/focus-sessions with the §9.1 concurrent-session confirm modal
//
// ponytail: plain <select> for the task picker instead of a searchable
// combobox (§8.1 mentions "searchable"). A single user's incomplete-tasks
// list fits in a native dropdown; search becomes relevant in the ~100+
// range. Upgrade path: swap the <select> for a Downshift / cmdk combobox
// in-place — the state shape is already `string | null`.

const PRESETS_MS = [25 * 60_000, 50 * 60_000, 90 * 60_000] as const;
type PresetMs = (typeof PRESETS_MS)[number];

export function StartSessionForm({
  variant = 'card',
}: {
  /// 'card' = padded standalone (widget / /focus top panel).
  /// 'compact' = no outer padding, for inline use.
  variant?: 'card' | 'compact';
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'timer' | 'open'>('timer');
  const [presetMs, setPresetMs] = useState<PresetMs>(PRESETS_MS[0]);
  const [customMin, setCustomMin] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SessionAlreadyActiveError | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Incomplete tasks (completedAt=null, archivedAt=null) across all kinds.
  // staleTime 30s — the picker is cosmetic optional metadata, so the user
  // starting a session before a brand-new task appears in the dropdown is
  // acceptable; next mount will catch up.
  const tasksQuery = useQuery({
    queryKey: tasksQueryKeys.list(),
    queryFn: () => listTasks(),
    staleTime: 30_000,
  });
  const incompleteTasks = (tasksQuery.data ?? [])
    .filter((t): t is TaskResponse =>
      t.completedAt === null && t.archivedAt === null,
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const start = useMutation({
    mutationFn: (body: StartFocusSessionRequest) => startSession(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.current() });
      void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.list() });
    },
    onError: (err: unknown) => {
      if (err instanceof SessionAlreadyActiveError) {
        setConflict(err);
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start session');
    },
  });

  // "Stop existing & start new" flow — two sequential calls (§9.1).
  const stopAndStart = useMutation({
    mutationFn: async (args: {
      existingId: string;
      body: StartFocusSessionRequest;
    }) => {
      await stopSession(args.existingId);
      return startSession(args.body);
    },
    onSuccess: () => {
      setConflict(null);
      void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.current() });
      void qc.invalidateQueries({ queryKey: focusSessionsQueryKeys.list() });
    },
    onError: (err: unknown) => {
      setConflict(null);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to replace session');
    },
  });

  function resolveDurationMs(): number | null {
    if (mode === 'open') return null;
    if (useCustom) {
      const mins = Number.parseInt(customMin, 10);
      if (!Number.isFinite(mins) || mins <= 0) return null;
      // Server caps at 24h; guard here too for a friendly error.
      const ms = mins * 60_000;
      return ms > 24 * 3600_000 ? 24 * 3600_000 : ms;
    }
    return presetMs;
  }

  function buildBody(): StartFocusSessionRequest | null {
    const taskLink = taskId ? { taskId } : {};
    if (mode === 'open') return { mode: 'open', ...taskLink };
    const ms = resolveDurationMs();
    if (ms == null) {
      setErrorMsg('Enter a duration in minutes.');
      return null;
    }
    return { mode: 'timer', plannedDurationMs: ms, ...taskLink };
  }

  function handleStart() {
    setErrorMsg(null);
    const body = buildBody();
    if (!body) return;
    start.mutate(body);
  }

  const busy = start.isPending || stopAndStart.isPending;
  const outer = variant === 'card' ? 'rounded-lg border border-neutral-800 bg-neutral-900 p-5' : '';

  return (
    <section className={outer}>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <ModeButton active={mode === 'timer'} onClick={() => setMode('timer')}>
          Timer
        </ModeButton>
        <ModeButton active={mode === 'open'} onClick={() => setMode('open')}>
          Open
        </ModeButton>
      </div>

      {mode === 'timer' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {PRESETS_MS.map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => {
                setPresetMs(ms);
                setUseCustom(false);
              }}
              className={`rounded border px-2.5 py-1 text-xs transition ${
                !useCustom && presetMs === ms
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {ms / 60_000}m
            </button>
          ))}
          <label
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              useCustom
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                : 'border-neutral-700 bg-neutral-900 text-neutral-400'
            }`}
          >
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => setUseCustom(e.target.checked)}
              className="h-3 w-3 accent-emerald-500"
            />
            Custom
            <input
              type="number"
              min="1"
              max="1440"
              value={customMin}
              onChange={(e) => {
                setCustomMin(e.target.value);
                setUseCustom(true);
              }}
              placeholder="min"
              className="w-14 rounded bg-neutral-950 px-1 py-0.5 text-right text-xs tabular-nums text-neutral-100 outline-none"
              aria-label="Custom duration in minutes"
            />
          </label>
        </div>
      )}

      {incompleteTasks.length > 0 && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <label htmlFor="focus-session-task" className="text-neutral-400">
            Task
          </label>
          <select
            id="focus-session-task"
            value={taskId ?? ''}
            onChange={(e) => setTaskId(e.target.value || null)}
            className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-emerald-500/60"
          >
            <option value="">— no task —</option>
            {incompleteTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {errorMsg && (
        <p className="mb-2 text-xs text-red-300" role="alert">
          {errorMsg}
        </p>
      )}

      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="w-full rounded-md bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start Session'}
      </button>

      {/* Concurrent-session confirm modal — §9.1 */}
      <Modal
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title="A focus session is already running"
        description={conflict ? describeExisting(conflict) : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
              disabled={stopAndStart.isPending}
            >
              Keep existing
            </button>
            <button
              type="button"
              onClick={() => {
                if (!conflict) return;
                const body = buildBody();
                if (!body) {
                  setConflict(null);
                  return;
                }
                stopAndStart.mutate({
                  existingId: conflict.body.existingSessionId,
                  body,
                });
              }}
              disabled={stopAndStart.isPending}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {stopAndStart.isPending ? 'Stopping…' : 'Stop & start new'}
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Stopping the existing session will end it with
          {' '}<code className="text-neutral-400">endReason: manual_stop</code>{' '}
          and start the new one you just configured. The old session will
          still appear in your history.
        </p>
      </Modal>
    </section>
  );
}

function describeExisting(err: SessionAlreadyActiveError): string {
  const { existingSession } = err.body;
  const startedMs = Date.parse(existingSession.startedAt);
  const elapsed = Math.max(0, Date.now() - startedMs);
  const when = new Date(startedMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const mode = existingSession.mode === 'timer' ? 'timer session' : 'open session';
  return `A ${existingSession.state} ${mode} started at ${when} (${formatDuration(elapsed)} elapsed).`;
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
          : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800'
      }`}
    >
      {children}
    </button>
  );
}
