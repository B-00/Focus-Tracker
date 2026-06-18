import type { ActivityRecentEvent } from '@focus-tracker/shared';
import { formatDuration } from '../../lib/format-duration';
import { relativeTime } from '../../lib/relative-time';

// "Recent switches" list — the only raw-event surface in v1
// (Activity.md §4.1). Reverse-chrono. Heartbeats and session lifecycle
// events show up too but get a distinct badge so the user can tell them
// apart at a glance.

interface RecentSwitchesProps {
  events: ActivityRecentEvent[];
  isLoading?: boolean;
}

export function RecentSwitches({ events, isLoading }: RecentSwitchesProps) {
  return (
    <section
      aria-label="Recent switches"
      className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[0.7rem] uppercase tracking-wider text-neutral-500">
          Recent switches
        </h3>
        <span className="text-[0.65rem] text-neutral-500">
          {events.length === 0 ? '—' : `last ${events.length}`}
        </span>
      </header>
      <ul className="divide-y divide-neutral-800/60 font-mono text-xs">
        {isLoading && events.length === 0 && (
          <li className="py-2 text-neutral-500">Loading…</li>
        )}
        {!isLoading && events.length === 0 && (
          <li className="py-2 text-neutral-500">
            No events yet. Pair a device in Settings to start capturing.
          </li>
        )}
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}

interface EventRowProps {
  event: ActivityRecentEvent;
}

function EventRow({ event }: EventRowProps) {
  const style = KIND_STYLES[event.kind];
  const label = describeEvent(event);
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span
        className={`shrink-0 rounded px-1.5 py-px text-[0.55rem] font-medium uppercase tracking-wider ${style.badge}`}
        title={event.kind}
      >
        {style.label}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-neutral-200"
        title={label}
      >
        {label}
      </span>
      {event.deviceLabel && (
        <span className="hidden shrink-0 text-[0.65rem] text-neutral-500 sm:inline">
          {event.deviceLabel}
        </span>
      )}
      <span className="shrink-0 text-neutral-500 tabular-nums">
        {formatDuration(event.durationMs ?? 0)}
      </span>
      <span
        className="shrink-0 text-neutral-500"
        title={new Date(event.startedAt).toLocaleString()}
      >
        {relativeTime(event.startedAt)}
      </span>
    </li>
  );
}

const KIND_STYLES: Record<
  ActivityRecentEvent['kind'],
  { label: string; badge: string }
> = {
  focus_change: { label: 'focus', badge: 'bg-emerald-950 text-emerald-300' },
  heartbeat: { label: 'beat', badge: 'bg-neutral-800 text-neutral-400' },
  session_start: { label: 'start', badge: 'bg-sky-950 text-sky-300' },
  session_end: { label: 'end', badge: 'bg-amber-950 text-amber-300' },
};

function describeEvent(event: ActivityRecentEvent): string {
  if (event.kind !== 'focus_change') {
    return event.kind === 'heartbeat'
      ? 'daemon alive'
      : event.kind === 'session_start'
        ? 'capture started'
        : 'capture stopped';
  }
  return event.target ?? 'unknown target';
}
