import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getState,
  openDashboard,
  setPaused,
  setTrackTitles,
  unpairLocal,
  type DesktopState,
} from '../lib/tauri';
import { relativeTime } from '../lib/relative-time';

interface PairedProps {
  state: DesktopState;
}

export function Paired({ state: initial }: PairedProps) {
  const qc = useQueryClient();

  // The Rust daemon mutates its own state out-of-band (queue depth grows
  // as focus_change events fire, last_flush_at updates on every successful
  // POST). Refetch every 5s so the UI tracks reality without bombarding
  // the bridge.
  const { data: state = initial } = useQuery({
    queryKey: ['desktop-state'],
    queryFn: getState,
    initialData: initial,
    refetchInterval: 5_000,
  });

  const pauseMutation = useMutation({
    mutationFn: setPaused,
    onSuccess: (next) => qc.setQueryData(['desktop-state'], next),
  });
  const trackTitlesMutation = useMutation({
    mutationFn: setTrackTitles,
    onSuccess: (next) => qc.setQueryData(['desktop-state'], next),
  });
  const openDashboardMutation = useMutation({ mutationFn: openDashboard });

  return (
    <section className="mx-auto flex max-w-md flex-col gap-5 px-6 py-7">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connected</h1>
          <p className="mt-1 text-xs text-neutral-400">
            Capturing foreground-window activity for {state.label}.
          </p>
        </div>
        <StatusDot
          running={state.daemonRunning}
          paused={state.paused}
        />
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Queue"
          value={state.queueDepth.toString()}
          hint={
            state.queueDepth === 0
              ? 'all caught up'
              : state.queueDepth >= 50
                ? 'flushing'
                : 'waiting for tick'
          }
        />
        <Stat
          label="Last flush"
          value={relativeTime(state.lastFlushAt)}
          hint={state.lastFlushAt ? 'API ack' : '—'}
        />
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-xs">
        <dt className="text-neutral-500">API base URL</dt>
        <dd className="truncate text-right font-mono text-neutral-300" data-selectable>
          {state.apiBaseUrl}
        </dd>

        <dt className="text-neutral-500">Device ID</dt>
        <dd
          className="truncate text-right font-mono text-[0.65rem] text-neutral-400"
          data-selectable
        >
          {state.deviceId}
        </dd>
      </dl>

      <fieldset className="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-xs">
        <legend className="px-1 text-[0.65rem] uppercase tracking-wider text-neutral-500">
          Capture
        </legend>

        <Toggle
          checked={!state.paused}
          onChange={(on) => pauseMutation.mutate(!on)}
          disabled={!state.daemonRunning || pauseMutation.isPending}
          title="Capture"
          subtitle={
            state.paused
              ? 'Paused — no new events recorded'
              : 'Recording focus changes and heartbeats'
          }
        />

        <Toggle
          checked={state.trackTitles}
          onChange={(on) => trackTitlesMutation.mutate(on)}
          disabled={trackTitlesMutation.isPending}
          title="Track window titles"
          subtitle={
            state.trackTitles
              ? 'Window titles included in events (default)'
              : 'App names only — titles dropped at the source'
          }
        />
      </fieldset>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => openDashboardMutation.mutate()}
          className="flex-1 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-800/60"
        >
          Open dashboard
        </button>
        <UnpairButton />
      </div>
    </section>
  );
}

function StatusDot({ running, paused }: { running: boolean; paused: boolean }) {
  const { color, label } = !running
    ? { color: 'bg-neutral-500', label: 'idle' }
    : paused
      ? { color: 'bg-amber-500', label: 'paused' }
      : { color: 'bg-emerald-500', label: 'live' };
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wider text-neutral-400">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm tabular-nums text-neutral-200">{value}</p>
      <p className="mt-0.5 text-[0.65rem] text-neutral-500">{hint}</p>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-neutral-200">{title}</span>
        <span className="block text-[0.65rem] text-neutral-500">{subtitle}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition disabled:opacity-50 ${
          checked
            ? 'border-emerald-700 bg-emerald-600/60'
            : 'border-neutral-700 bg-neutral-800'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-neutral-100 transition-transform ${
            checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function UnpairButton() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const unpairMutation = useMutation({
    mutationFn: unpairLocal,
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['desktop-state'] });
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-red-700 hover:bg-red-950/40 hover:text-red-200"
      >
        Unpair
      </button>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-xs">
      <p className="text-red-200">
        Remove the API key from this device? You'll need a new pairing code
        to reconnect.
      </p>
      {unpairMutation.isError && (
        <p className="text-red-300">
          Couldn't unpair: {unpairMutation.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={unpairMutation.isPending}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-[0.7rem] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => unpairMutation.mutate()}
          disabled={unpairMutation.isPending}
          className="rounded-md bg-red-600 px-2.5 py-1 text-[0.7rem] font-medium text-white transition hover:bg-red-500 disabled:bg-red-600/40"
        >
          {unpairMutation.isPending ? 'Unpairing…' : 'Unpair'}
        </button>
      </div>
    </div>
  );
}
