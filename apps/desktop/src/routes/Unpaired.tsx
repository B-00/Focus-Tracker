import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelPairing,
  pollPairing,
  setApiBaseUrl,
  startPairing,
  type DesktopState,
  type PairingHandle,
  type PairingStatus,
} from '../lib/tauri';

// The unpaired screen has three sub-states:
//
//   • idle         — show API base URL editor + "Pair this device" button
//   • generating   — start_pairing in flight
//   • code-issued  — show the 6-digit code, poll every 3s, transition out
//                    when status flips to "claimed" (refetches root query)

interface UnpairedProps {
  state: DesktopState;
}

type LocalView =
  | { kind: 'idle' }
  | { kind: 'pairing'; handle: PairingHandle };

export function Unpaired({ state }: UnpairedProps) {
  const [view, setView] = useState<LocalView>({ kind: 'idle' });

  if (view.kind === 'pairing') {
    return (
      <PairingPanel
        handle={view.handle}
        onCancel={() => setView({ kind: 'idle' })}
      />
    );
  }
  return (
    <IdlePanel
      state={state}
      onStarted={(handle) => setView({ kind: 'pairing', handle })}
    />
  );
}

// ---------------------------------------------------------------------------
//  Idle: edit API base URL + kick off pairing
// ---------------------------------------------------------------------------

interface IdlePanelProps {
  state: DesktopState;
  onStarted: (handle: PairingHandle) => void;
}

function IdlePanel({ state, onStarted }: IdlePanelProps) {
  const qc = useQueryClient();
  const [draftUrl, setDraftUrl] = useState(state.apiBaseUrl);

  const saveUrlMutation = useMutation({
    mutationFn: (url: string) => setApiBaseUrl(url),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['desktop-state'] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startPairing(),
    onSuccess: onStarted,
  });

  const urlIsDirty = draftUrl.trim() !== state.apiBaseUrl;
  const urlIsValid = isHttpUrl(draftUrl.trim());

  return (
    <section className="mx-auto flex max-w-md flex-col gap-5 px-6 py-7">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Pair this device</h1>
        <p className="mt-1 text-xs text-neutral-400">
          Connect this app to your Focus Tracker account to start sending
          activity. Pairing takes a few seconds.
        </p>
      </header>

      <fieldset className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
        <label htmlFor="api-base-url" className="block text-[0.7rem] font-medium uppercase tracking-wider text-neutral-400">
          API base URL
        </label>
        <input
          id="api-base-url"
          type="url"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="block w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 font-mono text-xs text-neutral-100 focus:border-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        />
        <p className="text-[0.65rem] text-neutral-500">
          Defaults to the local API. Change this if your Focus Tracker server
          is hosted elsewhere.
        </p>
        {urlIsDirty && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setDraftUrl(state.apiBaseUrl)}
              className="rounded-md px-2 py-1 text-[0.7rem] text-neutral-400 hover:text-neutral-200"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => saveUrlMutation.mutate(draftUrl.trim())}
              disabled={!urlIsValid || saveUrlMutation.isPending}
              className="rounded-md bg-accent-500 px-2 py-1 text-[0.7rem] font-medium text-neutral-950 transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:bg-accent-500/40"
            >
              {saveUrlMutation.isPending ? 'Saving…' : 'Save URL'}
            </button>
          </div>
        )}
        {saveUrlMutation.isError && (
          <p className="text-[0.7rem] text-red-300">
            Couldn't save: {saveUrlMutation.error.message}
          </p>
        )}
      </fieldset>

      <button
        type="button"
        onClick={() => startMutation.mutate()}
        disabled={startMutation.isPending || urlIsDirty}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/40"
      >
        {startMutation.isPending ? 'Generating code…' : 'Pair this device'}
      </button>
      {urlIsDirty && (
        <p className="-mt-3 text-center text-[0.7rem] text-amber-300">
          Save or discard the URL change before pairing.
        </p>
      )}
      {startMutation.isError && (
        <p className="-mt-3 text-center text-xs text-red-300">
          Couldn't reach the API: {startMutation.error.message}
        </p>
      )}

      <DetailRow label="Device ID" value={state.deviceId} mono />
      <DetailRow label="Label" value={state.label} />
      <DetailRow label="Config file" value={state.configPath} mono small />
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Pairing: display code + poll
// ---------------------------------------------------------------------------

interface PairingPanelProps {
  handle: PairingHandle;
  onCancel: () => void;
}

function PairingPanel({ handle, onCancel }: PairingPanelProps) {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second purely so the countdown re-renders.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expiresMs = new Date(handle.expiresAt).getTime() - now;
  const expired = expiresMs <= 0;

  const { data: status } = useQuery<PairingStatus>({
    queryKey: ['desktop-pairing-poll', handle.code],
    queryFn: pollPairing,
    // Spec calls for ~3s polling (DesktopApp.md §10). Stop polling once
    // we see a terminal status so the React Query cache doesn't churn.
    refetchInterval: (q) => {
      const s = q.state.data;
      if (!s) return 3000;
      if (s.status === 'pending') return 3000;
      return false;
    },
    enabled: !expired,
    retry: false,
  });

  // Side-effect: on claimed, invalidate the root state query so the App
  // re-renders into the Paired view.
  useEffect(() => {
    if (status?.status === 'claimed') {
      void qc.invalidateQueries({ queryKey: ['desktop-state'] });
    }
  }, [status, qc]);

  const cancelMutation = useMutation({
    mutationFn: cancelPairing,
    onSuccess: onCancel,
  });

  return (
    <section className="mx-auto flex max-w-md flex-col gap-5 px-6 py-7">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Enter this code</h1>
        <p className="mt-1 text-xs text-neutral-400">
          Open Focus Tracker in your browser, go to{' '}
          <span className="font-mono text-neutral-300">Settings → Devices</span>,
          click <span className="font-medium text-neutral-300">Pair new device</span>,
          and enter the code below.
        </p>
      </header>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-6 text-center">
        <p
          className="font-mono text-4xl font-semibold tracking-[0.4em] text-neutral-100"
          data-selectable
          aria-live="polite"
        >
          {handle.code}
        </p>
        <p className={`mt-3 text-xs ${expired ? 'text-red-300' : 'text-neutral-400'}`}>
          {expired
            ? 'Code expired. Cancel and start again to get a fresh one.'
            : `Expires in ${formatCountdown(expiresMs)}`}
        </p>
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-950/40 p-3 text-xs">
        {status?.status === 'pending' && (
          <p className="text-neutral-400">Waiting for the web app to confirm pairing…</p>
        )}
        {status?.status === 'expired' && (
          <p className="text-red-300">Code expired. Cancel and try again.</p>
        )}
        {status?.status === 'claimed' && (
          <p className="text-emerald-300">Paired as &ldquo;{status.label}&rdquo;. Finalising…</p>
        )}
        {!status && !expired && <p className="text-neutral-500">Polling…</p>}
      </div>

      <button
        type="button"
        onClick={() => cancelMutation.mutate()}
        disabled={cancelMutation.isPending}
        className="self-center rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Shared
// ---------------------------------------------------------------------------

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}

function DetailRow({ label, value, mono, small }: DetailRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-neutral-500">{label}</span>
      <span
        data-selectable
        className={[
          'truncate text-right text-neutral-300',
          mono && 'font-mono',
          small && 'text-[0.65rem]',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
