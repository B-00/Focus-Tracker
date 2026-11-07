import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { LifeWeekDetail, LifeWeekTopItem } from '@focus-tracker/shared';
import { Modal } from '../../components/Modal';
import {
  fetchLifeWeek,
  lifeWeekQueryKeys,
  upsertLifeWeekNote,
} from '../../lib/life-week-api';
import { MilestonesSection } from './MilestonesSection';

// Per-week detail modal (MementoMori.md §5.1 past-week drawer /
// §5.2 current-week read-only variant).
//
// Modal (not a drawer) per the user's layout call. Reuses the existing
// Modal primitive — Esc + backdrop close + focus trap come for free.
//
// Body:
//   * Date-range header
//   * Three-stat row (active time, sessions, tasks completed)
//   * Top apps + top sites (each capped at 3 server-side)
//   * WeekNote <textarea> — past weeks only. Current/future get a
//     muted explainer instead. Autosave is dual-trigger: debounced
//     1s while typing AND flushed on blur (spec §6.3 + §5.1).
//
// NOTE (perf): cheap endpoint (one Promise.all of indexed reads) +
// staleTime on the query means repeated open/close of the same week
// doesn't re-fetch. Mutations invalidate the per-week key so a note
// write immediately refreshes the "Saved · just now" line.

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const AUTOSAVE_DEBOUNCE_MS = 1000;
const MAX_NOTE_LEN = 2000;

export interface LifeWeekModalProps {
  weekIndex: number | null;
  onClose: () => void;
}

export function LifeWeekModal({ weekIndex, onClose }: LifeWeekModalProps) {
  const open = weekIndex !== null;
  // Snap the weekIndex into state once per open so a closing fade-out
  // (if we ever add one) doesn't flash blank content. For now it's
  // just a stable value for the query key below.
  const activeWeekIndex = weekIndex;

  const query = useQuery({
    queryKey: activeWeekIndex !== null
      ? lifeWeekQueryKeys.detail(activeWeekIndex)
      : ['life', 'week', 'disabled'],
    queryFn: () => fetchLifeWeek(activeWeekIndex!),
    enabled: open,
    staleTime: 30_000,
  });

  const title = useMemo(() => {
    const d = query.data;
    if (!d) return 'Week';
    const start = new Date(d.startDate);
    const end = new Date(d.endDate);
    return `${DATE_FMT.format(start)} – ${DATE_FMT.format(end)}`;
  }, [query.data]);

  const subtitle = useMemo(() => {
    const d = query.data;
    if (!d) return undefined;
    const base = `Week ${(d.weekIndex + 1).toLocaleString()} of your life`;
    if (d.isCurrent) return `${base} · this week`;
    if (!d.isPast) return `${base} · upcoming`;
    return base;
  }, [query.data]);

  return (
    <Modal open={open} onClose={onClose} title={title} description={subtitle}>
      {query.isLoading && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
      {query.isError && (
        <p className="text-sm text-red-300">
          Failed to load week:{' '}
          {query.error instanceof Error ? query.error.message : 'unknown error'}
        </p>
      )}
      {query.data && <WeekBody detail={query.data} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
//  Body — stats + top lists + note
// ---------------------------------------------------------------------------

function WeekBody({ detail }: { detail: LifeWeekDetail }) {
  return (
    <div className="flex flex-col gap-5">
      <StatsRow detail={detail} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TopList label="Top apps" items={detail.topApps} emptyLabel="No desktop activity" />
        <TopList label="Top sites" items={detail.topSites} emptyLabel="No browser activity" />
      </div>
      <MilestonesSection
        weekIndex={detail.weekIndex}
        weekStartDate={detail.startDate}
      />
      <NoteEditor detail={detail} />
    </div>
  );
}

function StatsRow({ detail }: { detail: LifeWeekDetail }) {
  const activeLabel = formatMinutes(detail.telemetryMinutes);
  const sessionsLabel =
    detail.sessions.count === 0
      ? '0'
      : `${detail.sessions.count} · ${formatHoursFromMs(detail.sessions.totalEffectiveMs)}`;
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Active time" value={activeLabel} />
      <Stat label="Focus sessions" value={sessionsLabel} />
      <Stat label="Tasks done" value={detail.tasksCompleted.toLocaleString()} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <p className="text-[0.65rem] uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="mt-1 font-mono tabular-nums text-sm font-semibold text-neutral-100">
        {value}
      </p>
    </div>
  );
}

function TopList({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: LifeWeekTopItem[];
  emptyLabel: string;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-400">
        {label}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li
              key={it.name}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="truncate text-neutral-200" title={it.name}>
                {it.name}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-neutral-400">
                {formatHoursFromMs(it.durationMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
//  NoteEditor — past-only textarea with debounced + on-blur autosave
// ---------------------------------------------------------------------------

function NoteEditor({ detail }: { detail: LifeWeekDetail }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(detail.note?.body ?? '');
  const [savedAt, setSavedAt] = useState<number | null>(
    detail.note ? Date.parse(detail.note.updatedAt) : null,
  );
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saving' | 'error'>(
    'idle',
  );
  // Baseline the draft against whatever the server last returned. If the
  // user flips to a different week (new `detail`), reset the local state.
  const lastServerBody = useRef(detail.note?.body ?? '');
  useEffect(() => {
    setDraft(detail.note?.body ?? '');
    lastServerBody.current = detail.note?.body ?? '';
    setSavedAt(detail.note ? Date.parse(detail.note.updatedAt) : null);
    setStatus('idle');
  }, [detail.weekIndex, detail.note?.updatedAt, detail.note?.body]);

  const mutation = useMutation({
    mutationFn: (body: string) => upsertLifeWeekNote(detail.weekIndex, body),
    onSuccess: (note) => {
      lastServerBody.current = note?.body ?? '';
      setSavedAt(note ? Date.parse(note.updatedAt) : Date.now());
      setStatus('idle');
      void qc.invalidateQueries({
        queryKey: lifeWeekQueryKeys.detail(detail.weekIndex),
      });
    },
    onError: () => setStatus('error'),
  });

  const flush = useCallback(
    (value: string) => {
      if (value === lastServerBody.current) {
        setStatus('idle');
        return;
      }
      setStatus('saving');
      mutation.mutate(value);
    },
    [mutation],
  );

  // Debounced autosave while typing. Timer resets on every keystroke
  // and fires 1s after the last change.
  useEffect(() => {
    if (status !== 'dirty') return;
    const id = window.setTimeout(() => flush(draft), AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [draft, status, flush]);

  if (!detail.isPast) {
    return (
      <section>
        <h3 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-400">
          Note
        </h3>
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-900/40 px-3 py-4 text-xs text-neutral-500">
          You&apos;ll be able to write a reflection once this week ends.
        </p>
      </section>
    );
  }

  const onChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    const next = e.currentTarget.value.slice(0, MAX_NOTE_LEN);
    setDraft(next);
    setStatus(next === lastServerBody.current ? 'idle' : 'dirty');
  };

  const onBlur: React.FocusEventHandler<HTMLTextAreaElement> = () => {
    // Blur always flushes — the debounce handles "pause while typing"
    // but blur is the stronger intent signal ("I'm done for now").
    if (status === 'dirty') flush(draft);
  };

  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-400">
          Note
        </h3>
        <SavedIndicator status={status} savedAt={savedAt} />
      </div>
      <textarea
        value={draft}
        onChange={onChange}
        onBlur={onBlur}
        rows={4}
        maxLength={MAX_NOTE_LEN}
        placeholder="What do you want to remember about this week?"
        className="block w-full resize-y rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none"
      />
      <p className="mt-1 text-right text-[0.65rem] text-neutral-600">
        {draft.length} / {MAX_NOTE_LEN}
      </p>
    </section>
  );
}

function SavedIndicator({
  status,
  savedAt,
}: {
  status: 'idle' | 'dirty' | 'saving' | 'error';
  savedAt: number | null;
}) {
  if (status === 'saving') {
    return <span className="text-[0.65rem] text-neutral-500">Saving…</span>;
  }
  if (status === 'dirty') {
    return <span className="text-[0.65rem] text-neutral-500">Unsaved</span>;
  }
  if (status === 'error') {
    return (
      <span className="text-[0.65rem] text-red-400">Save failed — retry on blur</span>
    );
  }
  if (!savedAt) {
    return <span className="text-[0.65rem] text-neutral-600">No note yet</span>;
  }
  return (
    <span className="text-[0.65rem] text-neutral-500">
      Saved {formatRelative(savedAt)}
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Formatting helpers
// ---------------------------------------------------------------------------

function formatMinutes(min: number): string {
  if (min <= 0) return '0 min';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 10) return `${h.toFixed(1)} h`;
  return `${Math.round(h)} h`;
}

function formatHoursFromMs(ms: number): string {
  if (ms <= 0) return '0 min';
  const min = Math.round(ms / 60_000);
  return formatMinutes(min);
}

function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
