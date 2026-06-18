import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRecentEvents,
  getState,
  openDashboard,
  setPaused,
  setRecentCapacity,
  unpairLocal,
  RECENT_CAPACITY_OPTIONS,
  type DesktopState,
  type RecentEvent,
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
  const openDashboardMutation = useMutation({ mutationFn: openDashboard });

  // Layout: single column on small windows (default ~700px wide), 2-column
  // grid on lg+ (≥1024px) so a maximised window puts controls on the left
  // and the activity feed on the right, both filling the available space.
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-7 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(340px,420px)_1fr] lg:items-start lg:gap-6">
      <header className="flex items-baseline justify-between gap-3 lg:col-span-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connected</h1>
          <p className="mt-1 text-xs text-neutral-400">
            Capturing app-level activity for {state.label}.
          </p>
        </div>
        <StatusDot running={state.daemonRunning} paused={state.paused} />
      </header>

      {/* Left column on lg+: stats + meta + capture toggle */}
      <div className="flex flex-col gap-5">
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
                : 'Recording app focus changes and heartbeats'
            }
          />
          <p className="border-t border-neutral-800 pt-3 text-[0.65rem] text-neutral-500">
            Tracks app names only — window titles are never captured.
          </p>
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
      </div>

      {/* Right column on lg+ — fills remaining height/width */}
      <RecentActivity
        daemonRunning={state.daemonRunning}
        capacity={state.recentCapacity}
      />
    </section>
  );
}

function RecentActivity({
  daemonRunning,
  capacity,
}: {
  daemonRunning: boolean;
  capacity: number;
}) {
  // Poll faster than getState() since this is the live feed. 2s feels
  // responsive without burning the bridge — captures are 1s-resolution
  // upstream so anything tighter would just observe noise.
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['desktop-recent-events'],
    queryFn: getRecentEvents,
    refetchInterval: 2_000,
    enabled: daemonRunning,
  });

  return (
    <section
      aria-label="Recent activity"
      className="flex flex-col gap-2 lg:h-[calc(100vh-12rem)] lg:min-h-[400px]"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
          Recent activity
        </p>
        <CapacityPicker
          shown={events.length}
          capacity={capacity}
        />
      </div>
      <ul
        className="max-h-64 flex-1 space-y-0.5 overflow-y-auto rounded border border-neutral-800 bg-neutral-950/60 p-1.5 font-mono text-[0.65rem] lg:max-h-none"
        aria-live="polite"
      >
        {!daemonRunning && (
          <li className="px-2 py-2 text-neutral-500">Daemon idle — start by pairing.</li>
        )}
        {daemonRunning && isLoading && (
          <li className="px-2 py-2 text-neutral-500">Loading…</li>
        )}
        {daemonRunning && !isLoading && events.length === 0 && (
          <li className="px-2 py-2 text-neutral-500">
            No events yet. Switch apps or wait a minute for a heartbeat.
          </li>
        )}
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}

function EventRow({ event }: { event: RecentEvent }) {
  const kindStyle = KIND_STYLES[event.kind];
  const label = describeEvent(event);
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-900/60">
      <span
        className={`shrink-0 rounded px-1.5 py-px text-[0.55rem] font-medium uppercase tracking-wider ${kindStyle.badge}`}
        title={event.kind}
      >
        {kindStyle.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-neutral-300" title={label}>
        {label}
      </span>
      <span className="shrink-0 text-neutral-500">{formatDuration(event.durationMs)}</span>
      <span
        className="shrink-0 text-neutral-500"
        title={new Date(event.startedAt).toLocaleString()}
      >
        {relativeTime(event.startedAt)}
      </span>
    </li>
  );
}

function CapacityPicker({
  shown,
  capacity,
}: {
  shown: number;
  capacity: number;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: setRecentCapacity,
    onSuccess: (next) => {
      qc.setQueryData(['desktop-state'], next);
      // Force a refetch so the feed reflects the new cap immediately
      // instead of waiting for the 2s poll to discover the resize.
      void qc.invalidateQueries({ queryKey: ['desktop-recent-events'] });
    },
  });

  // Always render the current persisted capacity even if it's not one of
  // the canonical presets (e.g. someone hand-edited config.json to 17).
  // The Rust side clamps so it'll already be inside [MIN, MAX].
  const options = RECENT_CAPACITY_OPTIONS.includes(
    capacity as (typeof RECENT_CAPACITY_OPTIONS)[number],
  )
    ? RECENT_CAPACITY_OPTIONS
    : ([...RECENT_CAPACITY_OPTIONS, capacity].sort(
        (a, b) => a - b,
      ) as readonly number[]);

  return (
    <label className="flex items-baseline gap-1.5 text-[0.6rem] text-neutral-600">
      <span>last {shown} of</span>
      <select
        value={capacity}
        disabled={mutation.isPending}
        onChange={(e) => mutation.mutate(Number(e.target.value))}
        aria-label="Recent activity buffer size"
        className="cursor-pointer rounded border border-neutral-800 bg-neutral-900/80 px-1 py-px text-[0.6rem] text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200 focus:border-neutral-500 focus:text-neutral-200 focus:outline-none disabled:opacity-50"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

const KIND_STYLES: Record<RecentEvent['kind'], { label: string; badge: string }> = {
  focus_change: {
    label: 'focus',
    badge: 'bg-emerald-950 text-emerald-300',
  },
  heartbeat: {
    label: 'beat',
    badge: 'bg-neutral-800 text-neutral-400',
  },
  session_start: {
    label: 'start',
    badge: 'bg-sky-950 text-sky-300',
  },
  session_end: {
    label: 'end',
    badge: 'bg-amber-950 text-amber-300',
  },
};

function describeEvent(event: RecentEvent): string {
  if (event.kind !== 'focus_change') {
    return event.kind === 'heartbeat'
      ? 'daemon alive'
      : event.kind === 'session_start'
        ? 'capture started'
        : 'capture stopped';
  }
  return event.app ?? 'unknown app';
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '';
  if (ms < 1_000) return `${ms}ms`;
  const s = Math.round(ms / 1_000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return remS === 0 ? `${m}m` : `${m}m${remS}s`;
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
  // Geometry: track 24x44, knob 20x20, top:2px left:2px → 2px gap on top,
  // bottom, and the resting (off) side. translate-x-5 = 20px = (track 44
  // - knob 20 - 2*2 padding) so the knob lands with the same 2px padding
  // on the right when on. Symmetric and stays fully inside the track.
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
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          checked ? 'bg-emerald-600' : 'bg-neutral-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-neutral-100 shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
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
