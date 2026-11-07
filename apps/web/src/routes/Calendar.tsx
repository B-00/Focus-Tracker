import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SectionResponse, TaskResponse } from '@focus-tracker/shared';
import {
  listSections,
  listTasks,
  sectionsQueryKeys,
  tasksQueryKeys,
} from '../lib/tasks-api';
import { PRIORITY_SORT_INDEX } from './tasks/PriorityBadge';
import {
  usePriorityColors,
  withAlpha,
} from './tasks/priority-colors';

// /calendar — Slice 1 (Calendar.md §5 / §3).
//
// Scope locked at this slice:
//   - Month grid: 7 cols × 5–6 rows, Monday-first (§5.1).
//   - Prev / Next / Today header controls (§5).
//   - Single-day dated tasks render as pills in their day cell (§3.1).
//   - Today cell visually distinct (§3.3).
//
// Deferred (later slices):
//   - Multi-day range bars that span cells (§3.1).
//   - Past-focus-session day indicator + popover (§3.2 / §4.4).
//   - Click empty day → inline composer (§4.1).
//   - Click pill → edit / delete popover (§4.2 / §4.3).
//   - Server-side `?from=&to=` filtering — v1 personal data is small
//     enough that fetching all dated tasks and filtering client-side is
//     trivially fast. ponytail: single-user scale; upgrade path is to
//     add `from`/`to` to listTasksQuerySchema when the task count makes
//     the payload wasteful.
//
// Data: reuses the shared `tasks` query key with `{kind: 'dated'}`, so
// a dated-task change anywhere else (Dashboard, /tasks) invalidates
// this surface for free.

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PRIORITY_GLYPH = {
  extreme: '▲▲',
  high: '▲',
  mid: '●',
  low: '▽',
} as const;

const INBOX_COLOR = '#737373'; // neutral-500, matches other "no section" surfaces

export function CalendarPage() {
  // `cursor` is any day inside the month currently displayed. Separate
  // from "today" so we can freely navigate without clobbering the Today
  // affordance.
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));

  const sectionsQuery = useQuery({
    queryKey: sectionsQueryKeys.list(),
    queryFn: listSections,
  });
  const datedQuery = useQuery({
    queryKey: tasksQueryKeys.list({ kind: 'dated' }),
    queryFn: () => listTasks({ kind: 'dated' }),
  });

  const sectionsById = useMemo(() => {
    const map = new Map<string, SectionResponse>();
    for (const s of sectionsQuery.data ?? []) map.set(s.id, s);
    return map;
  }, [sectionsQuery.data]);

  // Group single-day dated tasks by their YYYY-MM-DD. Multi-day tasks are
  // deferred to Slice 5, but we still bin them by start-date so the user
  // sees *something* on the start day rather than losing the task entirely.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskResponse[]>();
    for (const t of datedQuery.data ?? []) {
      if (t.inBacklog) continue; // Backlog has its own surface (Tasks.md §3.5)
      const day = t.startDate;
      if (!day) continue;
      const bucket = map.get(day);
      if (bucket) bucket.push(t);
      else map.set(day, [t]);
    }
    // Priority DESC, then createdAt ASC (Calendar.md §3.1 sort rule).
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        const pa = PRIORITY_SORT_INDEX[a.priority];
        const pb = PRIORITY_SORT_INDEX[b.priority];
        if (pa !== pb) return pa - pb;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }
    return map;
  }, [datedQuery.data]);

  const monthDays = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(cursor),
    [cursor],
  );

  const isError = sectionsQuery.isError || datedQuery.isError;
  const isLoading =
    (sectionsQuery.isLoading || datedQuery.isLoading) && !isError;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Dated tasks by day. Click a task row to jump to it in Tasks.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((d) => addMonths(d, -1))}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 text-neutral-300 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="rounded-md border border-neutral-800 px-3 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCursor((d) => addMonths(d, 1))}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 text-neutral-300 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-neutral-200">{monthLabel}</h2>
          {isLoading && (
            <span className="text-xs text-neutral-500">Loading…</span>
          )}
          {isError && (
            <span className="text-xs text-red-300">Failed to load tasks.</span>
          )}
        </div>

        {/* Weekday header */}
        <div
          className="grid grid-cols-7 gap-1 text-[0.65rem] font-medium uppercase tracking-wider text-neutral-500"
          aria-hidden
        >
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="px-2 py-1">
              {w}
            </div>
          ))}
        </div>

        {/* Month grid */}
        <div
          role="grid"
          aria-label={`${monthLabel} calendar grid`}
          className="mt-1 grid grid-cols-7 gap-1"
        >
          {monthDays.map((day) => {
            const ymd = toYmd(day);
            const inMonth = day.getMonth() === cursor.getMonth();
            const today = isSameDay(day, new Date());
            const tasks = tasksByDay.get(ymd) ?? [];
            return (
              <DayCell
                key={ymd}
                date={day}
                inMonth={inMonth}
                today={today}
                tasks={tasks}
                sectionsById={sectionsById}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

interface DayCellProps {
  date: Date;
  inMonth: boolean;
  today: boolean;
  tasks: TaskResponse[];
  sectionsById: Map<string, SectionResponse>;
}

function DayCell({ date, inMonth, today, tasks, sectionsById }: DayCellProps) {
  const dayNum = date.getDate();
  // `role="gridcell"` is required by the grid above. We also label the
  // cell so screen readers announce "Today, June 12" per §3.2 / §8.
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
  // ponytail: pure-CSS hover tooltip via `group` + opacity transition.
  // Cheaper than the Life grid's rect-captured floating tooltip because
  // a month grid is 42 cells max and the tooltip only needs to clear
  // the cell it sits over — no viewport-edge drift worth solving.
  const hasTasks = tasks.length > 0;
  return (
    <div
      role="gridcell"
      aria-label={today ? `Today, ${dateLabel}` : dateLabel}
      className={[
        'group relative min-h-[6rem] rounded-md border p-1.5 text-xs',
        today
          ? 'border-emerald-500/60 bg-emerald-500/5'
          : 'border-neutral-800 bg-neutral-900/30',
        inMonth ? '' : 'opacity-40',
      ].join(' ')}
    >
      <div
        className={`mb-1 flex items-center justify-between text-[0.7rem] ${
          today ? 'text-emerald-300' : 'text-neutral-400'
        }`}
      >
        <span className={today ? 'font-semibold' : ''}>{dayNum}</span>
        {today && (
          <span className="text-[0.6rem] uppercase tracking-wider">Today</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {tasks.map((t) => (
          <TaskPill
            key={t.id}
            task={t}
            section={t.sectionId ? sectionsById.get(t.sectionId) : undefined}
          />
        ))}
      </div>
      {hasTasks && (
        <DayTooltip
          dateLabel={dateLabel}
          tasks={tasks}
          sectionsById={sectionsById}
        />
      )}
    </div>
  );
}

interface DayTooltipProps {
  dateLabel: string;
  tasks: TaskResponse[];
  sectionsById: Map<string, SectionResponse>;
}

// Per-cell task list, revealed on hover. Lives inside the cell as a
// `group-hover` opacity transition so there's no JS at all. `z-20` keeps
// it above sibling cells; `left-1/2 -translate-x-1/2` centers it over
// the cell; `-translate-y-full -top-2` floats it above the cell with
// an 8px gap. `max-h-56 overflow-y-auto` guards against future days
// with a huge pile of tasks without pushing the tooltip past the viewport.
function DayTooltip({ dateLabel, tasks, sectionsById }: DayTooltipProps) {
  const priorityColors = usePriorityColors();
  return (
    <div
      role="tooltip"
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-full -mt-2 w-56 max-h-56 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-950/95 p-2 text-[0.7rem] text-neutral-100 opacity-0 shadow-xl backdrop-blur transition-opacity duration-150 group-hover:opacity-100"
    >
      <p className="mb-1.5 font-medium text-neutral-300">{dateLabel}</p>
      <ul className="flex flex-col gap-1">
        {tasks.map((t) => {
          const section = t.sectionId ? sectionsById.get(t.sectionId) : undefined;
          const completed = t.completedAt !== null;
          return (
            <li
              key={t.id}
              className={`flex items-start gap-1.5 ${completed ? 'text-neutral-400 line-through' : ''}`}
            >
              <span
                aria-hidden
                className="shrink-0 font-semibold"
                style={{ color: priorityColors[t.priority] }}
              >
                {PRIORITY_GLYPH[t.priority]}
              </span>
              <span className="flex-1">
                <span className="block">{t.title}</span>
                <span className="block text-[0.6rem] text-neutral-500">
                  {section?.name ?? 'Inbox'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface TaskPillProps {
  task: TaskResponse;
  section: SectionResponse | undefined;
}

function TaskPill({ task, section }: TaskPillProps) {
  const priorityColors = usePriorityColors();
  const fill = section?.color ?? INBOX_COLOR;
  const priorityHex = priorityColors[task.priority];
  const sectionName = section?.name ?? 'Inbox';
  const glyph = PRIORITY_GLYPH[task.priority];
  const completed = task.completedAt !== null;
  const ariaLabel = `${capitalize(task.priority)} priority — ${task.title} — ${sectionName}`;

  return (
    <div
      aria-label={ariaLabel}
      title={`${glyph} ${task.title} · ${sectionName}`}
      className={[
        'flex items-center gap-1 overflow-hidden rounded border-l-2 px-1.5 py-0.5 text-[0.7rem]',
        completed ? 'text-neutral-400 line-through opacity-70' : 'text-neutral-100',
      ].join(' ')}
      style={{
        backgroundColor: withAlpha(fill, 0.25),
        borderLeftColor: priorityHex,
      }}
    >
      <span aria-hidden className="shrink-0 font-semibold" style={{ color: priorityHex }}>
        {glyph}
      </span>
      <span className="truncate">{task.title}</span>
    </div>
  );
}

// -------------------------------------------------------------------
// Date helpers — tiny because the grid only needs month-boundary math.
// Native Date is enough; keeps us off date-fns for v1 (ponytail: single
// stdlib call site; upgrade path is `date-fns` if we ever need
// week/day/agenda views that multiply the calendar math).
// -------------------------------------------------------------------

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/// Build a 5- or 6-row month grid. First column is Monday
/// (Calendar.md §5.1); leading days come from the previous month, trailing
/// days from the next, so every row is 7 cells wide.
function buildMonthGrid(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  // JS: Sunday = 0 ... Saturday = 6. Monday-first → ((d + 6) % 7).
  const leading = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - leading);

  const daysInMonth = new Date(
    cursor.getFullYear(),
    cursor.getMonth() + 1,
    0,
  ).getDate();
  // Smallest multiple of 7 that covers leading + daysInMonth — either 35 or 42.
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

  const out: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    out.push(d);
  }
  return out;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------
// Dev self-check — grid math is the only non-trivial piece; if the
// Monday-first shift or the 35-vs-42 cell count regress, every row
// is wrong. Catch it on first import rather than through visual bugs.
// ---------------------------------------------------------------------
if (import.meta.env?.DEV) {
  // Feb 2026 — starts Sunday, 28 days → leading=6, total=35.
  const feb2026 = buildMonthGrid(new Date(2026, 1, 15));
  if (feb2026.length !== 35) {
    // eslint-disable-next-line no-console
    console.warn('[calendar] expected 35 cells for Feb 2026, got', feb2026.length);
  }
  if (toYmd(feb2026[0]) !== '2026-01-26') {
    // eslint-disable-next-line no-console
    console.warn('[calendar] Feb 2026 grid starts wrong:', toYmd(feb2026[0]));
  }
  // May 2026 — starts Friday, 31 days → leading=4, cells 35 covers
  // only through May 30 (needs 42).
  const may2026 = buildMonthGrid(new Date(2026, 4, 15));
  if (may2026.length !== 42) {
    // eslint-disable-next-line no-console
    console.warn('[calendar] expected 42 cells for May 2026, got', may2026.length);
  }
}
