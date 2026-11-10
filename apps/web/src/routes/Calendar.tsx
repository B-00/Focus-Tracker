import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  TASK_PRIORITIES,
  type CreateTaskRequest,
  type SectionResponse,
  type TaskPriority,
  type TaskResponse,
  type UpdateTaskRequest,
} from '@focus-tracker/shared';
import {
  createTask,
  deleteTask,
  listSections,
  listTasks,
  sectionsQueryKeys,
  tasksQueryKeys,
  updateTask,
} from '../lib/tasks-api';
import { PRIORITY_SORT_INDEX, PriorityIcon } from './tasks/PriorityBadge';
import { usePriorityColors } from './tasks/priority-colors';

// /calendar — Slices 1–5 (Calendar.md §5 / §3 / §4.1–§4.3).
//
// Scope now:
//   - Month grid: 7 cols × 4–6 rows, Sunday-first.
//     (Calendar.md §5.1 originally called for Monday-first; user-
//     requested override — Sunday-first matches the Google/Apple
//     Calendar convention most of our users already live in.)
//   - Prev / Next / Today header controls (§5).
//   - Dated tasks render as bar segments inside their week row:
//       - single-day tasks = 1-col-wide bar
//       - multi-day tasks = N-col-wide bar, wrapped at week boundaries
//         so a Nov 10 → Nov 25 task becomes 3 week-sized segments.
//     Bars are absolute-positioned over a 7-col overlay grid so they
//     span cells visually (gaps between cells are filled by the bar's
//     own background).
//   - Slot-packed vertical placement — a bar keeps the same slot across
//     all the cells it spans within its week, so overlapping/adjacent
//     bars never jump vertically mid-range.
//   - "Continued" chevrons: ← prefix on bars whose range begins before
//     the visible grid, → suffix on bars that extend past it.
//   - Today cell visually distinct (§3.2).
//   - Per-cell hover tooltip listing the day's tasks (§3.3).
//   - Click an empty area of a cell → inline composer with title +
//     priority (required) + section + end-date toggle (§4.1).
//   - Composer lists the day's INTERSECTING tasks (not just ones that
//     start on that day) with inline confirm-then-delete.
//   - Click a bar → same composer opens on the DAY YOU CLICKED (derived
//     from the mouse x-position within the bar, not the bar's start)
//     with that task's row expanded into an inline edit form.
//
// Deferred (later slices):
//   - Server-side `?from=&to=` filtering — v1 personal data is small
//     enough that fetching all dated tasks and filtering client-side is
//     trivially fast. ponytail: single-user scale; upgrade path is to
//     add `from`/`to` to listTasksQuerySchema when the task count makes
//     the payload wasteful.
//
// Data: reuses the shared `tasks` query key with `{kind: 'dated'}`, so
// a dated-task change anywhere else (Dashboard, /tasks) invalidates
// this surface for free. Create / update / delete all hit the shared
// mutations so the server contract matches /tasks exactly.

// Bar rendering geometry — kept as integers so slot math is honest in
// px rather than rem-rounding surprises. Tuned to match the current
// text-[0.7rem] bar + 0.5 vertical padding that the pill had in slices
// 1–4, so visual regression vs. the old pill is minimal.
const BAR_HEIGHT_PX = 20;
const BAR_SLOT_GAP_PX = 2;
const BAR_SLOT_STEP_PX = BAR_HEIGHT_PX + BAR_SLOT_GAP_PX;
// Space above slot 0: cell padding (p-1.5 = 6px) + date header + mb-1.
const CELL_BAR_TOP_PX = 30;
// Minimum breathing room below the last slot before cell padding.
const CELL_BAR_BOTTOM_PX = 10;
const CELL_MIN_HEIGHT_PX = 96; // = 6rem, matches slices 1–4

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const INBOX_COLOR = '#737373'; // neutral-500, matches other "no section" surfaces

const END_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function CalendarPage() {
  // `cursor` is any day inside the month currently displayed. Separate
  // from "today" so we can freely navigate without clobbering the Today
  // affordance.
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  // Only one composer can be open at a time (Calendar.md §4.1). Null when
  // no cell is in compose mode; otherwise holds the YMD of the open cell.
  // Esc / click-outside / successful submit all clear it.
  const [composerDay, setComposerDay] = useState<string | null>(null);
  // Optional: when the composer was opened by clicking a pill (Slice 4
  // / §4.2), this holds the id of the task to pre-expand into edit mode.
  // Null → composer opens with just the "new task" form focused.
  const [editTaskId, setEditTaskId] = useState<string | null>(null);

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

  // Group dated tasks by every day they INTERSECT (not just their start
  // date). Multi-day tasks appear in each day of their range, so the
  // composer's existing-tasks list and the hover tooltip both show a
  // task on any day it's active.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskResponse[]>();
    for (const t of datedQuery.data ?? []) {
      if (t.inBacklog) continue; // Backlog has its own surface (Tasks.md §3.5)
      if (!t.startDate) continue;
      const end =
        t.endDate && t.endDate >= t.startDate ? t.endDate : t.startDate;
      for (const ymd of eachDayInRangeInclusive(t.startDate, end)) {
        const bucket = map.get(ymd);
        if (bucket) bucket.push(t);
        else map.set(ymd, [t]);
      }
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
  const weeks = useMemo(() => groupIntoWeeks(monthDays), [monthDays]);
  // Per-week packed bar segments. Reads from the raw task list so slot
  // packing sees full task objects (endDate for continuesLeft/Right).
  const weekBars = useMemo(
    () => buildWeekSegments(weeks, datedQuery.data ?? []),
    [weeks, datedQuery.data],
  );

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
          className="grid grid-cols-7 text-[0.65rem] font-medium uppercase tracking-wider text-neutral-500"
          aria-hidden
        >
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="px-2 py-1">
              {w}
            </div>
          ))}
        </div>

        {/* Month grid — week rows stacked vertically. Each WeekRow owns
            a 7-col backdrop of day cells plus an absolute-positioned
            7-col overlay for bar segments spanning cells. */}
        <div
          role="grid"
          aria-label={`${monthLabel} calendar grid`}
          className="mt-1 divide-y divide-neutral-800 rounded-md border border-neutral-800"
        >
          {weeks.map((weekDays, weekIndex) => (
            <WeekRow
              key={toYmd(weekDays[0])}
              weekDays={weekDays}
              bars={weekBars[weekIndex]}
              cursorMonth={cursor.getMonth()}
              composerDay={composerDay}
              editTaskId={editTaskId}
              sectionsById={sectionsById}
              sections={sectionsQuery.data ?? []}
              tasksByDay={tasksByDay}
              onOpenComposer={(ymd) => {
                setComposerDay(ymd);
                setEditTaskId(null);
              }}
              onRequestEdit={(ymd, taskId) => {
                setComposerDay(ymd);
                setEditTaskId(taskId);
              }}
              onClearEdit={() => setEditTaskId(null)}
              onCloseComposer={() => {
                setComposerDay(null);
                setEditTaskId(null);
              }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

// -------------------------------------------------------------------
// WeekRow — one row of 7 day cells plus an absolute-positioned overlay
// of bar segments. Using an overlay instead of rendering bars inside
// each cell lets a bar span multiple columns as one continuous element
// (including over the inter-cell gap), which is the core of Slice 5.
//
// The overlay is a second grid-cols-7 container with the SAME gap as
// the backdrop; bars use `gridColumnStart/End` to span columns and an
// inline `top` to position in the right slot. `pointer-events-none`
// on the overlay lets background clicks fall through to the cell
// (opens composer); individual bars re-enable pointer events.
//
// Cell height is driven by this week's slotCount so cells only grow
// as tall as the densest week needs — a sparse week stays compact.
// -------------------------------------------------------------------

interface WeekRowProps {
  weekDays: Date[];
  bars: WeekBars;
  cursorMonth: number;
  composerDay: string | null;
  editTaskId: string | null;
  sectionsById: Map<string, SectionResponse>;
  sections: SectionResponse[];
  tasksByDay: Map<string, TaskResponse[]>;
  onOpenComposer: (ymd: string) => void;
  onRequestEdit: (ymd: string, taskId: string) => void;
  onClearEdit: () => void;
  onCloseComposer: () => void;
}

function WeekRow({
  weekDays,
  bars,
  cursorMonth,
  composerDay,
  editTaskId,
  sectionsById,
  sections,
  tasksByDay,
  onOpenComposer,
  onRequestEdit,
  onClearEdit,
  onCloseComposer,
}: WeekRowProps) {
  const cellMinHeight = Math.max(
    CELL_MIN_HEIGHT_PX,
    CELL_BAR_TOP_PX + bars.slotCount * BAR_SLOT_STEP_PX + CELL_BAR_BOTTOM_PX,
  );
  return (
    <div className="relative">
      {/* Backdrop: 7 day cells, seamless — thin dividers, no gaps, so a
          spanning bar reads as one block instead of crossing 7 cards. */}
      <div className="grid grid-cols-7 divide-x divide-neutral-800">
        {weekDays.map((day) => {
          const ymd = toYmd(day);
          const inMonth = day.getMonth() === cursorMonth;
          const today = isSameDay(day, new Date());
          const tasks = tasksByDay.get(ymd) ?? [];
          return (
            <DayFrame
              key={ymd}
              date={day}
              ymd={ymd}
              inMonth={inMonth}
              today={today}
              minHeightPx={cellMinHeight}
              tasks={tasks}
              sectionsById={sectionsById}
              sections={sections}
              composerOpen={composerDay === ymd}
              editTaskId={composerDay === ymd ? editTaskId : null}
              onOpenComposer={() => onOpenComposer(ymd)}
              onRequestEdit={(taskId) => onRequestEdit(ymd, taskId)}
              onClearEdit={onClearEdit}
              onCloseComposer={onCloseComposer}
            />
          );
        })}
      </div>
      {/* Overlay: bar segments positioned over the backdrop grid. Same
          `grid-cols-7` (no gap) so columns line up exactly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 grid grid-cols-7"
      >
        {bars.segments.map((seg) => (
          <BarSegment
            key={`${seg.task.id}-${toYmd(weekDays[0])}`}
            segment={seg}
            weekDays={weekDays}
            section={
              seg.task.sectionId ? sectionsById.get(seg.task.sectionId) : undefined
            }
            onRequestEdit={onRequestEdit}
          />
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// DayFrame — one day cell's background + date label + composer/tooltip.
// Owns NO pills (bars live in the WeekRow overlay). Height is set
// externally so every cell in a week row is uniform.
// -------------------------------------------------------------------

interface DayFrameProps {
  date: Date;
  ymd: string;
  inMonth: boolean;
  today: boolean;
  minHeightPx: number;
  tasks: TaskResponse[];
  sectionsById: Map<string, SectionResponse>;
  sections: SectionResponse[];
  composerOpen: boolean;
  editTaskId: string | null;
  onOpenComposer: () => void;
  onRequestEdit: (taskId: string) => void;
  onClearEdit: () => void;
  onCloseComposer: () => void;
}

function DayFrame({
  date,
  ymd,
  inMonth,
  today,
  minHeightPx,
  tasks,
  sectionsById,
  sections,
  composerOpen,
  editTaskId,
  onOpenComposer,
  onRequestEdit,
  onClearEdit,
  onCloseComposer,
}: DayFrameProps) {
  const dayNum = date.getDate();
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
  const hasTasks = tasks.length > 0;
  // Only open the composer when the user actually clicked the cell
  // background. Bars live in a sibling overlay and have their own
  // click handler; the composer's internal clicks stopPropagation.
  function handleCellClick(e: React.MouseEvent<HTMLDivElement>) {
    if (composerOpen) return;
    if (e.target !== e.currentTarget) return;
    onOpenComposer();
  }
  // Fade only the date label for leading/trailing-month days. Bars
  // overlaid on these cells stay crisp (they're siblings, not children).
  const fadeClass = inMonth ? '' : 'opacity-40';
  return (
    <div
      role="gridcell"
      aria-label={today ? `Today, ${dateLabel}` : dateLabel}
      onClick={handleCellClick}
      style={{ minHeight: `${minHeightPx}px` }}
      className={[
        'group relative cursor-pointer p-1.5 text-xs transition-colors hover:bg-neutral-800/30',
        // Today = soft tint + top accent line (no box outline to fight bars).
        today
          ? 'bg-emerald-500/5 shadow-[inset_0_2px_0_0_rgb(16_185_129)]'
          : 'bg-neutral-900/30',
      ].join(' ')}
    >
      <div
        className={`pointer-events-none mb-1 flex items-center justify-between text-[0.7rem] ${
          today ? 'text-emerald-300' : 'text-neutral-400'
        } ${fadeClass}`}
      >
        <span className={today ? 'font-semibold' : ''}>{dayNum}</span>
        {today && (
          <span className="text-[0.6rem] uppercase tracking-wider">Today</span>
        )}
      </div>
      {hasTasks && !composerOpen && (
        <DayTooltip
          dateLabel={dateLabel}
          tasks={tasks}
          sectionsById={sectionsById}
        />
      )}
      {composerOpen && (
        <CellComposer
          ymd={ymd}
          dateLabel={dateLabel}
          sections={sections}
          tasks={tasks}
          sectionsById={sectionsById}
          editTaskId={editTaskId}
          onRequestEdit={onRequestEdit}
          onClearEdit={onClearEdit}
          onClose={onCloseComposer}
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
                className="shrink-0"
                style={{ color: priorityColors[t.priority] }}
              >
                <PriorityIcon priority={t.priority} size={11} />
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

interface BarSegmentProps {
  segment: WeekSegment;
  weekDays: Date[];
  section: SectionResponse | undefined;
  onRequestEdit: (ymd: string, taskId: string) => void;
}

// One bar segment overlaid on a WeekRow. A single-day task is just a
// 1-col-wide bar; a multi-day task gets one BarSegment per week it
// intersects. Rounded corners only on the "real" start/end of the
// task's range; week-wrap edges are flat + show a continued chevron.
//
// Click handling: the clicked column within the segment is derived from
// mouse x-position so clicking the middle of a 5-day bar opens the
// composer on the day you actually clicked, not the bar's start.
// ponytail: stopPropagation is intentionally OMITTED — matches how the
// Slice 4 pill worked, so the open composer's click-outside listener
// can close it before the new composer opens.
function BarSegment({ segment, weekDays, section, onRequestEdit }: BarSegmentProps) {
  const priorityColors = usePriorityColors();
  const { task, startCol, endCol, slot, continuesLeft, continuesRight } = segment;
  const fill = section?.color ?? INBOX_COLOR;
  const priorityHex = priorityColors[task.priority];
  const sectionName = section?.name ?? 'Inbox';
  const completed = task.completedAt !== null;
  const cellSpan = endCol - startCol + 1;
  const ariaLabel = `Edit ${capitalize(task.priority)} priority task — ${task.title} — ${sectionName}${
    cellSpan > 1 ? ` — ${cellSpan}-day range` : ''
  }`;

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Figure out which column within the segment was clicked so the
    // composer opens on THAT day, not the segment's start.
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const colWidth = rect.width / cellSpan;
    const localCol = Math.min(cellSpan - 1, Math.max(0, Math.floor(relX / colWidth)));
    const dayYmd = toYmd(weekDays[startCol + localCol]);
    onRequestEdit(dayYmd, task.id);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={`${task.title} · ${sectionName}`}
      style={{
        gridColumnStart: startCol + 1,
        gridColumnEnd: endCol + 2,
        marginTop: `${CELL_BAR_TOP_PX + slot * BAR_SLOT_STEP_PX}px`,
        height: `${BAR_HEIGHT_PX}px`,
        // Opaque: the alpha tint is composited over neutral-900 so
        // dividers / Today tint don't show through the bar.
        backgroundColor: `color-mix(in srgb, ${fill} 35%, #171717)`,
        borderLeftColor: continuesLeft ? 'transparent' : priorityHex,
        // Round only the "real" edges of the task's full range.
        borderTopLeftRadius: continuesLeft ? 0 : '0.25rem',
        borderBottomLeftRadius: continuesLeft ? 0 : '0.25rem',
        borderTopRightRadius: continuesRight ? 0 : '0.25rem',
        borderBottomRightRadius: continuesRight ? 0 : '0.25rem',
      }}
      className={[
        'pointer-events-auto mx-1 flex items-center gap-1 overflow-hidden border-l-2 px-1.5 text-left text-[0.7rem] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400',
        completed ? 'text-neutral-400 line-through opacity-70' : 'text-neutral-100',
      ].join(' ')}
    >
      {continuesLeft && (
        <span aria-hidden className="shrink-0 text-neutral-400">
          ←
        </span>
      )}
      <span aria-hidden className="shrink-0" style={{ color: priorityHex }}>
        <PriorityIcon priority={task.priority} size={11} />
      </span>
      <span className="flex-1 truncate">{task.title}</span>
      {/* Due date at the right edge of the segment holding the real end;
          2+ cols only so a 1-day pill keeps its room for the title. */}
      {!continuesRight && cellSpan > 1 && task.endDate && (
        <span aria-hidden className="shrink-0 whitespace-nowrap pl-1 text-[0.65rem] text-neutral-400">
          → {END_DATE_FMT.format(parseYmd(task.endDate))}
        </span>
      )}
      {continuesRight && (
        <span aria-hidden className="shrink-0 text-neutral-400">
          →
        </span>
      )}
    </button>
  );
}

// -------------------------------------------------------------------
// CellComposer — inline dated-task creator (Calendar.md §4.1).
//
// Design decisions:
//   - Dated-only. Calendar never creates routine/ongoing tasks.
//   - startDate is fixed to the clicked day; the user can add an
//     endDate for a range task (turns the pill into a future range —
//     visible in Slice 5 when we render range bars).
//   - priority is required, no default — same keyboard flow as the
//     /tasks page: title → Tab → priority → Enter.
//   - section is optional; omitted → Inbox (null sectionId).
//   - Enter submits, Esc cancels, click-outside closes.
//   - Reuses the shared `createTask` mutation + `tasksQueryKeys.all`
//     invalidation so the pill shows up on /tasks and the dashboard
//     widgets the instant the server returns.
//
// ponytail: all state local; no store needed. The one piece of
// cross-cell state ("which cell is open") lives at CalendarPage so only
// one composer is active at a time.
// -------------------------------------------------------------------

interface CellComposerProps {
  ymd: string;
  dateLabel: string;
  sections: SectionResponse[];
  tasks: TaskResponse[];
  sectionsById: Map<string, SectionResponse>;
  editTaskId: string | null;
  onRequestEdit: (taskId: string) => void;
  onClearEdit: () => void;
  onClose: () => void;
}

function CellComposer({
  ymd,
  dateLabel,
  sections,
  tasks,
  sectionsById,
  editTaskId,
  onRequestEdit,
  onClearEdit,
  onClose,
}: CellComposerProps) {
  const qc = useQueryClient();
  const rootRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [sectionId, setSectionId] = useState<string>(''); // '' = Inbox
  const [addEnd, setAddEnd] = useState(false);
  const [endDate, setEndDate] = useState<string>(ymd);

  const createMutation = useMutation({
    mutationFn: (body: CreateTaskRequest) => createTask(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      onClose();
    },
  });

  // Close on Esc (anywhere) + click-outside this composer. Both reset
  // the composer-open state at the parent; local state resets on unmount.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDocClick(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [onClose]);

  const canSubmit =
    title.trim().length > 0 &&
    priority !== '' &&
    !createMutation.isPending;

  function submit() {
    if (!canSubmit) return;
    createMutation.mutate({
      kind: 'dated',
      title: title.trim(),
      priority: priority as TaskPriority,
      sectionId: sectionId === '' ? null : sectionId,
      startDate: ymd,
      endDate: addEnd && endDate !== ymd ? endDate : null,
      /// transferIfMissed stays false here — the user can opt in from
      /// the full /tasks editor. Covering it inline would bloat the
      /// composer past "frictionless creation" (Calendar.md goal #2).
      transferIfMissed: false,
    });
  }

  return (
    <form
      ref={rootRef}
      role="dialog"
      aria-label={`New task on ${dateLabel}`}
      // Stop the parent cell's click handler (and the document-level
      // click-outside listener) from firing on inner clicks. Native form
      // onSubmit handles Enter semantics correctly: Enter in <input type=text>
      // submits the form, Enter in <select> opens the native dropdown.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="absolute left-1/2 top-full z-30 mt-1 w-64 -translate-x-1/2 rounded-md border border-neutral-700 bg-neutral-950/95 p-2 text-[0.7rem] shadow-xl backdrop-blur"
    >
      <div className="mb-1.5 flex items-center justify-between text-[0.6rem] uppercase tracking-wider text-neutral-500">
        <span>{dateLabel}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="text-neutral-500 hover:text-neutral-300"
        >
          ✕
        </button>
      </div>
      {tasks.length > 0 && (
        <ul className="mb-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto border-b border-neutral-800 pb-2">
          {tasks.map((t) => (
            <ExistingTaskRow
              key={t.id}
              task={t}
              section={t.sectionId ? sectionsById.get(t.sectionId) : undefined}
              sections={sections}
              isEditing={editTaskId === t.id}
              onEnterEdit={() => onRequestEdit(t.id)}
              onClearEdit={onClearEdit}
            />
          ))}
        </ul>
      )}
      <div className="mb-1 text-[0.6rem] uppercase tracking-wider text-neutral-500">
        New task
      </div>
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        maxLength={200}
        className="mb-1.5 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none"
      />
      <div className="mb-1.5 flex gap-1.5">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority | '')}
          required
          aria-label="Priority (required)"
          className={`flex-1 rounded border px-1.5 py-1 text-[0.7rem] focus:outline-none ${
            priority === ''
              ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
              : 'border-neutral-700 bg-neutral-900 text-neutral-200'
          }`}
        >
          <option value="" disabled>
            Priority…
          </option>
          {TASK_PRIORITIES.slice().reverse().map((p) => (
            <option key={p} value={p}>
              {capitalize(p)}
            </option>
          ))}
        </select>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          aria-label="Section"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[0.7rem] text-neutral-200 focus:outline-none"
        >
          <option value="">Inbox</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <label className="mb-1.5 flex items-center gap-1.5 text-neutral-400">
        <input
          type="checkbox"
          checked={addEnd}
          onChange={(e) => setAddEnd(e.target.checked)}
          className="h-3 w-3 accent-emerald-500"
        />
        <span>Add end date</span>
        {addEnd && (
          <input
            type="date"
            value={endDate}
            min={ymd}
            onChange={(e) => setEndDate(e.target.value)}
            className="ml-auto rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
          />
        )}
      </label>
      <div className="flex items-center justify-between">
        {createMutation.isError && (
          <span className="text-[0.6rem] text-red-300">
            {(createMutation.error as Error).message}
          </span>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="ml-auto rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[0.7rem] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createMutation.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------------
// ExistingTaskRow — one row inside the composer listing tasks already
// on the clicked day. Three mutually-exclusive modes:
//
//   view:    glyph + title (clickable → enters edit) + ✕ (→ confirm)
//   confirm: glyph + title + [Delete] [Cancel]  (delete affordance)
//   edit:    inline form (title / priority+section / dates / complete /
//            Save+Cancel). Controlled by parent via `isEditing` so a
//            pill-click or another row's click can flip which row is
//            being edited — EditTaskForm's useState resets naturally
//            because the form only mounts while isEditing is true.
//
// Successful delete / save invalidate `tasksQueryKeys.all` so /tasks,
// dashboard, and the calendar itself all re-sync.
// -------------------------------------------------------------------

interface ExistingTaskRowProps {
  task: TaskResponse;
  section: SectionResponse | undefined;
  sections: SectionResponse[];
  isEditing: boolean;
  onEnterEdit: () => void;
  onClearEdit: () => void;
}

function ExistingTaskRow({
  task,
  section,
  sections,
  isEditing,
  onEnterEdit,
  onClearEdit,
}: ExistingTaskRowProps) {
  const qc = useQueryClient();
  const priorityColors = usePriorityColors();
  const [confirming, setConfirming] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
    },
  });
  const completed = task.completedAt !== null;
  const sectionName = section?.name ?? 'Inbox';

  // Edit and confirm modes are mutually exclusive — if the parent flips
  // this row into edit mode mid-confirm, drop the confirm state.
  useEffect(() => {
    if (isEditing) setConfirming(false);
  }, [isEditing]);

  if (isEditing) {
    return (
      <li className="rounded bg-neutral-900/60 p-1.5">
        <EditTaskForm
          task={task}
          sections={sections}
          onCancel={onClearEdit}
          onSaved={onClearEdit}
        />
      </li>
    );
  }

  return (
    <li
      className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${
        completed ? 'text-neutral-500 line-through' : 'text-neutral-100'
      }`}
    >
      <span
        aria-hidden
        className="shrink-0"
        style={{ color: priorityColors[task.priority] }}
      >
        <PriorityIcon priority={task.priority} size={11} />
      </span>
      <button
        type="button"
        onClick={onEnterEdit}
        className="min-w-0 flex-1 truncate text-left hover:text-emerald-300 focus:outline-none focus-visible:text-emerald-300"
        title={`Edit "${task.title}" · ${sectionName}`}
        aria-label={`Edit "${task.title}"`}
      >
        {task.title}
      </button>
      {confirming ? (
        <>
          <button
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="shrink-0 rounded border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-[0.6rem] text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            {deleteMutation.isPending ? '…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleteMutation.isPending}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.6rem] text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="shrink-0 rounded px-1 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          aria-label={`Delete "${task.title}"`}
          title="Delete"
        >
          ✕
        </button>
      )}
    </li>
  );
}

// -------------------------------------------------------------------
// EditTaskForm — inline form for editing a single existing dated task
// (Calendar.md §4.2). Only mounts while its row is in edit mode, so
// useState initializers snapshot the task's current values naturally.
//
// Save button submits via `updateTask`. Only sends fields the user
// actually changed — avoids churning updatedAt on no-op saves.
// -------------------------------------------------------------------

interface EditTaskFormProps {
  task: TaskResponse;
  sections: SectionResponse[];
  onCancel: () => void;
  onSaved: () => void;
}

function EditTaskForm({ task, sections, onCancel, onSaved }: EditTaskFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [sectionId, setSectionId] = useState<string>(task.sectionId ?? '');
  const [startDate, setStartDate] = useState<string>(task.startDate ?? '');
  const [endDate, setEndDate] = useState<string>(task.endDate ?? task.startDate ?? '');
  const [completed, setCompleted] = useState<boolean>(task.completedAt !== null);

  const updateMutation = useMutation({
    mutationFn: (body: UpdateTaskRequest) => updateTask(task.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
      onSaved();
    },
    // ponytail: if the task was deleted elsewhere (another tab, cache
    // got stale between render and save), the PATCH returns 404. Just
    // refetch — the stale row vanishes from the calendar and the form
    // unmounts naturally. Cleaner than leaving an axios error on screen.
    onError: (err: unknown) => {
      const status =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 404) {
        void qc.invalidateQueries({ queryKey: tasksQueryKeys.all });
        onSaved();
      }
    },
  });

  const trimmed = title.trim();
  const canSave = trimmed.length > 0 && !updateMutation.isPending;

  function save() {
    if (!canSave) return;
    // Only send changed fields (updateTaskRequestSchema rejects empty
    // objects, so we require at least one diff before firing).
    const body: UpdateTaskRequest = {};
    if (trimmed !== task.title) body.title = trimmed;
    if (priority !== task.priority) body.priority = priority;
    const nextSectionId = sectionId === '' ? null : sectionId;
    if (nextSectionId !== task.sectionId) body.sectionId = nextSectionId;
    if (startDate && startDate !== task.startDate) body.startDate = startDate;
    const nextEndDate = endDate && endDate !== startDate ? endDate : null;
    if (nextEndDate !== task.endDate) body.endDate = nextEndDate;
    const wasCompleted = task.completedAt !== null;
    if (completed !== wasCompleted) {
      body.completedAt = completed ? new Date().toISOString() : null;
    }
    if (Object.keys(body).length === 0) {
      // Nothing changed — silently close.
      onSaved();
      return;
    }
    updateMutation.mutate(body);
  }

  return (
    // ponytail: <div>, not <form> — this is rendered INSIDE CellComposer's
    // own <form>, and nested forms are invalid HTML (the inner is dropped,
    // so onSubmit never fires + Save would submit the outer composer).
    // Enter-to-save is handled by a keydown handler on the title input.
    <div className="flex flex-col gap-1.5">
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
        maxLength={200}
        aria-label="Task title"
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-emerald-500/50 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          aria-label="Priority"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[0.7rem] text-neutral-200 focus:outline-none"
        >
          {TASK_PRIORITIES.slice().reverse().map((p) => (
            <option key={p} value={p}>
              {capitalize(p)}
            </option>
          ))}
        </select>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          aria-label="Section"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[0.7rem] text-neutral-200 focus:outline-none"
        >
          <option value="">Inbox</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 text-[0.65rem] text-neutral-400">
        {/* Native date inputs are ~120px wide after the picker icon, so
            two side-by-side don't fit the 256px composer — stack them. */}
        <label className="flex items-center gap-1.5">
          <span className="w-10 shrink-0">Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-200 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="w-10 shrink-0">End</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-200 focus:outline-none"
          />
        </label>
      </div>
      <label className="flex items-center gap-1.5 text-[0.7rem] text-neutral-300">
        <input
          type="checkbox"
          checked={completed}
          onChange={(e) => setCompleted(e.target.checked)}
          className="h-3 w-3 accent-emerald-500"
        />
        <span>Completed</span>
      </label>
      <div className="flex items-center justify-end gap-1">
        {updateMutation.isError && (
          <span className="mr-auto text-[0.6rem] text-red-300">
            {(updateMutation.error as Error).message}
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={updateMutation.isPending}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
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

/// Build a 4- to 6-row month grid. First column is Sunday (user
/// preference — overrides Calendar.md §5.1 Monday-first default);
/// leading days come from the previous month, trailing days from
/// the next, so every row is 7 cells wide.
function buildMonthGrid(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  // JS: Sunday = 0 ... Saturday = 6. Sunday-first → use getDay() directly.
  const leading = first.getDay();
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

/// Parse a YYYY-MM-DD date string into a local Date at midnight.
/// Using the `T00:00:00` suffix anchors to local time so native Date
/// arithmetic matches what the user sees on the grid; otherwise the
/// string is parsed as UTC and shifts across day boundaries west of
/// GMT.
function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`);
}

/// Inclusive list of days between `start` and `end` as YYYY-MM-DD.
/// If `end < start` returns just `[start]` (defensive — the composer
/// clamps End ≥ Start, but data from the API has no such guarantee).
function eachDayInRangeInclusive(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  if (endYmd < startYmd) return [startYmd];
  const cur = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  while (cur.getTime() <= end.getTime()) {
    out.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/// Chunk a flat day array (length always multiple of 7) into weeks.
function groupIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

/// A single bar segment inside one week row. A multi-week task produces
/// one of these per week it intersects; a single-day task produces one
/// 1-col-wide segment.
interface WeekSegment {
  task: TaskResponse;
  /// 0-based column within the week (0 = Sunday).
  startCol: number;
  /// 0-based inclusive end column.
  endCol: number;
  /// Row within the week's bar stack. Packed greedy by priority DESC,
  /// then startCol ASC — see assignSlots below.
  slot: number;
  /// Task's range extends to days before this week.
  continuesLeft: boolean;
  /// Task's range extends to days after this week.
  continuesRight: boolean;
}

/// Per-week packed segments plus how many slots were needed (drives
/// the week's cell min-height).
interface WeekBars {
  segments: WeekSegment[];
  slotCount: number;
}

/// Greedy slot packing within one week. Input segments are mutated
/// in place to receive their `slot` number. Returns the total slot
/// count used so the caller can size cell heights.
///
/// ponytail: greedy per-week, sorted by priority then start col. Not
/// optimal packing, but a calendar is read top-to-bottom and the
/// user expects higher-priority bars at the top. Optimal bin-packing
/// is a known NP-hard problem; nobody needs that here.
function assignSlots(segments: WeekSegment[]): number {
  // Sort for display + packing: priority DESC (extreme on top), then
  // startCol ASC, then stable by taskId as a tiebreaker.
  segments.sort((a, b) => {
    const pa = PRIORITY_SORT_INDEX[a.task.priority];
    const pb = PRIORITY_SORT_INDEX[b.task.priority];
    if (pa !== pb) return pa - pb;
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return a.task.id.localeCompare(b.task.id);
  });
  // slots[i] = highest endCol currently occupied in that slot, or -1.
  const slotEndCols: number[] = [];
  for (const seg of segments) {
    let slotIdx = 0;
    while (slotIdx < slotEndCols.length && slotEndCols[slotIdx] >= seg.startCol) {
      slotIdx++;
    }
    if (slotIdx === slotEndCols.length) slotEndCols.push(seg.endCol);
    else slotEndCols[slotIdx] = seg.endCol;
    seg.slot = slotIdx;
  }
  return slotEndCols.length;
}

/// For each week, compute its packed bar segments. Tasks are matched
/// against the week by YMD-string comparison (lexicographic order ==
/// chronological for ISO dates, so no Date parsing needed in the hot
/// path).
function buildWeekSegments(
  weeks: Date[][],
  tasks: TaskResponse[],
): WeekBars[] {
  return weeks.map((weekDays) => {
    const weekStartYmd = toYmd(weekDays[0]);
    const weekEndYmd = toYmd(weekDays[6]);
    const segments: WeekSegment[] = [];
    for (const task of tasks) {
      if (task.inBacklog) continue;
      if (!task.startDate) continue;
      const taskStart = task.startDate;
      const taskEnd = task.endDate && task.endDate >= taskStart ? task.endDate : taskStart;
      // Skip if entire task range is outside this week.
      if (taskEnd < weekStartYmd || taskStart > weekEndYmd) continue;
      // Clamp to the week and translate to 0-6 columns.
      const segStartYmd = taskStart < weekStartYmd ? weekStartYmd : taskStart;
      const segEndYmd = taskEnd > weekEndYmd ? weekEndYmd : taskEnd;
      const startCol = weekDays.findIndex((d) => toYmd(d) === segStartYmd);
      const endCol = weekDays.findIndex((d) => toYmd(d) === segEndYmd);
      if (startCol === -1 || endCol === -1) continue; // defensive
      segments.push({
        task,
        startCol,
        endCol,
        slot: 0,
        continuesLeft: taskStart < weekStartYmd,
        continuesRight: taskEnd > weekEndYmd,
      });
    }
    const slotCount = assignSlots(segments);
    return { segments, slotCount };
  });
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------
// Dev self-check — grid math is the only non-trivial piece; if the
// Sunday-first shift or the 28/35/42 cell count regress, every row
// is wrong. Catch it on first import rather than through visual bugs.
// ---------------------------------------------------------------------
if (import.meta.env?.DEV) {
  // Feb 2026 — starts Sunday, 28 days → Sunday-first leading=0,
  // total=28 (cleanly packs into 4 rows).
  const feb2026 = buildMonthGrid(new Date(2026, 1, 15));
  if (feb2026.length !== 28) {
    // eslint-disable-next-line no-console
    console.warn('[calendar] expected 28 cells for Feb 2026, got', feb2026.length);
  }
  if (toYmd(feb2026[0]) !== '2026-02-01') {
    // eslint-disable-next-line no-console
    console.warn('[calendar] Feb 2026 grid starts wrong:', toYmd(feb2026[0]));
  }
  // May 2026 — starts Friday, 31 days → Sunday-first leading=5,
  // total=42 (first cell = Apr 26, Sun).
  const may2026 = buildMonthGrid(new Date(2026, 4, 15));
  if (may2026.length !== 42) {
    // eslint-disable-next-line no-console
    console.warn('[calendar] expected 42 cells for May 2026, got', may2026.length);
  }
  if (toYmd(may2026[0]) !== '2026-04-26') {
    // eslint-disable-next-line no-console
    console.warn('[calendar] May 2026 grid starts wrong:', toYmd(may2026[0]));
  }
  // Range expansion — inclusive, both ends.
  const range = eachDayInRangeInclusive('2026-02-27', '2026-03-02');
  const expected = ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'];
  if (range.join(',') !== expected.join(',')) {
    // eslint-disable-next-line no-console
    console.warn('[calendar] range expansion wrong:', range);
  }
  // Slot packing — three bars with partial overlap. Expected slot
  // layout (after priority-desc sort): A(high) slot 0 cols 0-3,
  // B(mid) slot 1 cols 2-5, C(low) slot 0 cols 4-6 (reuses slot 0
  // because A ends before C starts).
  const mk = (id: string, pri: TaskPriority, startCol: number, endCol: number) => ({
    task: { id, priority: pri, createdAt: id, startDate: '2026-01-01', endDate: null } as unknown as TaskResponse,
    startCol,
    endCol,
    slot: 0,
    continuesLeft: false,
    continuesRight: false,
  });
  const segs: WeekSegment[] = [mk('C', 'low', 4, 6), mk('A', 'high', 0, 3), mk('B', 'mid', 2, 5)];
  const slots = assignSlots(segs);
  const byId = Object.fromEntries(segs.map((s) => [s.task.id, s.slot]));
  if (slots !== 2 || byId.A !== 0 || byId.B !== 1 || byId.C !== 0) {
    // eslint-disable-next-line no-console
    console.warn('[calendar] slot packing wrong:', { slots, byId });
  }
}
