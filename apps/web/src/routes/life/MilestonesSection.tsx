import { useMemo, useState, type FormEvent } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Baby,
  Briefcase,
  Cake,
  Camera,
  Flag,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Milestone as MilestoneIcon,
  Mountain,
  Pencil,
  Plane,
  Plus,
  Gem,
  Rocket,
  Star,
  Trash2,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  MILESTONE_LABEL_MAX,
  type Milestone,
} from '@focus-tracker/shared';
import {
  createMilestone,
  deleteMilestone,
  fetchMilestones,
  milestoneQueryKeys,
  updateMilestone,
} from '../../lib/milestones-api';
import { lifeQueryKeys } from '../../lib/life-api';

// Reusable milestones block for the per-week modals (MementoMori.md
// §5.1 / §5.2 / §5.3 / §5.4). Lists existing milestones for the given
// week and offers add / edit / delete without leaving the modal.
//
// Icons: curated set of 16 lucide-react components. Picking the whole
// lucide namespace would bloat the bundle for a one-off UI; 16 covers
// the obvious life milestones (graduation, job, move, marriage,
// child, birthday, trip…) and we can extend the map later.
//
// Colors: 6 presets + a native <input type="color"> for anything else.
// The server validates `#RGB | #RRGGBB | #RRGGBBAA` — presets stay
// inside that envelope.

const ICON_CHOICES: { name: string; Icon: LucideIcon; label: string }[] = [
  { name: 'MilestoneIcon', Icon: MilestoneIcon, label: 'Milestone' },
  { name: 'GraduationCap', Icon: GraduationCap, label: 'Graduation' },
  { name: 'Briefcase', Icon: Briefcase, label: 'Career' },
  { name: 'Home', Icon: Home, label: 'Move' },
  { name: 'Heart', Icon: Heart, label: 'Love' },
  { name: 'Gem', Icon: Gem, label: 'Marriage' },
  { name: 'Baby', Icon: Baby, label: 'Baby' },
  { name: 'Cake', Icon: Cake, label: 'Birthday' },
  { name: 'Plane', Icon: Plane, label: 'Travel' },
  { name: 'Mountain', Icon: Mountain, label: 'Challenge' },
  { name: 'Star', Icon: Star, label: 'Achievement' },
  { name: 'Trophy', Icon: Trophy, label: 'Win' },
  { name: 'Flag', Icon: Flag, label: 'Goal' },
  { name: 'Rocket', Icon: Rocket, label: 'Launch' },
  { name: 'Gift', Icon: Gift, label: 'Celebration' },
  { name: 'Camera', Icon: Camera, label: 'Memory' },
];

const ICON_BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  ICON_CHOICES.map(({ name, Icon }) => [name, Icon]),
);

export function iconFor(name: string | null): LucideIcon {
  if (!name) return MilestoneIcon;
  return ICON_BY_NAME[name] ?? MilestoneIcon;
}

const COLOR_PRESETS = [
  '#34d399', // emerald
  '#fbbf24', // amber
  '#60a5fa', // sky
  '#f472b6', // pink
  '#ef4444', // red
  '#a78bfa', // violet
];

export interface MilestonesSectionProps {
  /// When provided, the list filters to this week only and new-milestone
  /// forms seed the date from `weekStartDate`. When omitted (Settings
  /// §4.2), the list shows ALL milestones sorted by target date asc —
  /// the single canonical management surface.
  weekIndex?: number;
  /// yyyy-mm-dd. Used as the default targetDate for new milestones when
  /// in per-week mode. In all-milestones mode, defaults to today.
  weekStartDate?: string;
}

const TODAY_YMD = (): string => new Date().toISOString().slice(0, 10);

export function MilestonesSection({
  weekIndex,
  weekStartDate,
}: MilestonesSectionProps) {
  const query = useQuery({
    queryKey: milestoneQueryKeys.list(),
    queryFn: fetchMilestones,
    staleTime: 30_000,
  });

  const scoped = weekIndex !== undefined;
  const milestones = useMemo(() => {
    const all = query.data ?? [];
    if (scoped) return all.filter((m) => m.weekIndex === weekIndex);
    // All-milestones mode: sort by target date asc so the user reads
    // them in life-timeline order (Settings.md §4.2).
    return [...all].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  }, [query.data, scoped, weekIndex]);

  const defaultDate = weekStartDate ?? TODAY_YMD();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const emptyLabel = scoped
    ? 'No milestones for this week yet.'
    : 'No milestones yet. Add one to mark a week on your life grid.';

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-400">
          Milestones
        </h3>
        {!adding && editingId === null && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[0.65rem] text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100"
          >
            <Plus size={12} aria-hidden /> Add
          </button>
        )}
      </div>

      {query.isLoading && (
        <p className="text-xs text-neutral-500">Loading milestones…</p>
      )}

      {milestones.length === 0 && !adding && !query.isLoading && (
        <p className="text-xs text-neutral-500">{emptyLabel}</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {milestones.map((m) =>
          editingId === m.id ? (
            <li key={m.id}>
              <MilestoneForm
                initial={m}
                defaultDate={defaultDate}
                onCancel={() => setEditingId(null)}
                onSaved={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={m.id}>
              <MilestoneRow
                milestone={m}
                showDate={!scoped}
                onEdit={() => setEditingId(m.id)}
              />
            </li>
          ),
        )}
      </ul>

      {adding && (
        <div className="mt-2">
          <MilestoneForm
            initial={null}
            defaultDate={defaultDate}
            onCancel={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Row — one existing milestone with edit / delete controls
// ---------------------------------------------------------------------------

function MilestoneRow({
  milestone,
  showDate,
  onEdit,
}: {
  milestone: Milestone;
  showDate: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteMilestone(milestone.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: milestoneQueryKeys.list() });
      void qc.invalidateQueries({ queryKey: lifeQueryKeys.grid() });
    },
  });
  const Icon = iconFor(milestone.icon);

  return (
    <div className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1.5">
      <Icon size={14} style={{ color: milestone.color }} aria-hidden />
      <span className="flex-1 truncate text-xs text-neutral-200" title={milestone.label}>
        {milestone.label}
      </span>
      {showDate && (
        <span
          className="shrink-0 font-mono text-[0.65rem] text-neutral-500"
          title={milestone.targetDate}
        >
          {milestone.targetDate}
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${milestone.label}`}
        className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        aria-label={`Delete ${milestone.label}`}
        className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-300 disabled:opacity-40"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Form — reused for both Add and Edit flows
// ---------------------------------------------------------------------------

function MilestoneForm({
  initial,
  defaultDate,
  onCancel,
  onSaved,
}: {
  initial: Milestone | null;
  defaultDate: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [color, setColor] = useState(initial?.color ?? COLOR_PRESETS[0]!);
  const [icon, setIcon] = useState<string>(initial?.icon ?? 'MilestoneIcon');
  const [targetDate, setTargetDate] = useState(
    initial?.targetDate ?? defaultDate,
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createMilestone({ targetDate, label: label.trim(), color, icon }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: milestoneQueryKeys.list() });
      void qc.invalidateQueries({ queryKey: lifeQueryKeys.grid() });
      onSaved();
    },
    onError: (e) => setError(messageFromError(e, 'Could not create milestone')),
  });
  const update = useMutation({
    mutationFn: () =>
      updateMilestone(initial!.id, {
        targetDate,
        label: label.trim(),
        color,
        icon,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: milestoneQueryKeys.list() });
      void qc.invalidateQueries({ queryKey: lifeQueryKeys.grid() });
      onSaved();
    },
    onError: (e) => setError(messageFromError(e, 'Could not save milestone')),
  });

  const pending = create.isPending || update.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Label is required.');
      return;
    }
    if (trimmed.length > MILESTONE_LABEL_MAX) {
      setError(`Label is capped at ${MILESTONE_LABEL_MAX} characters.`);
      return;
    }
    setError(null);
    if (initial) update.mutate();
    else create.mutate();
  };

  const Preview = iconFor(icon);

  return (
    <form
      onSubmit={onSubmit}
      className="rounded border border-neutral-800 bg-neutral-900/60 p-3"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: `${color}22` }}
          aria-hidden
        >
          <Preview size={14} style={{ color }} />
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Milestone label"
          maxLength={MILESTONE_LABEL_MAX}
          autoFocus
          className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[0.7rem] text-neutral-200 focus:border-emerald-500/50 focus:outline-none"
        />
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div className="mt-2">
        <IconPicker value={icon} onChange={setIcon} />
      </div>

      {error && (
        <p className="mt-2 text-[0.65rem] text-red-300">{error}</p>
      )}

      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded border border-neutral-800 px-2 py-1 text-[0.65rem] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X size={12} aria-hidden /> Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-[0.65rem] font-semibold text-emerald-200 ring-1 ring-emerald-400/40 transition hover:bg-emerald-500/30 disabled:opacity-40"
        >
          {pending ? 'Saving…' : initial ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {COLOR_PRESETS.map((c) => {
        const active = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Color ${c}`}
            aria-pressed={active}
            className={`h-5 w-5 rounded border transition ${
              active
                ? 'border-neutral-100 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]'
                : 'border-neutral-700 hover:border-neutral-500'
            }`}
            style={{ backgroundColor: c }}
          />
        );
      })}
      {/* Native color picker as the "custom" escape hatch — hidden
          swatch triggers the OS color dialog. Mirrors LifeColorPicker. */}
      <span
        className="relative inline-block h-5 w-5 overflow-hidden rounded border border-dashed border-neutral-600"
        title="Custom color"
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Custom milestone color"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.55rem] text-neutral-400"
        >
          +
        </span>
      </span>
    </div>
  );
}

function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {ICON_CHOICES.map(({ name, Icon, label }) => {
        const active = name === value;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={`flex h-6 w-6 items-center justify-center rounded border transition ${
              active
                ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
            }`}
          >
            <Icon size={12} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Error helper — axios wraps server errors in .response.data
// ---------------------------------------------------------------------------

interface AxiosLike {
  response?: { data?: { message?: string; error?: string } };
}

function messageFromError(err: unknown, fallback: string): string {
  const e = err as AxiosLike | undefined;
  const msg = e?.response?.data?.message ?? e?.response?.data?.error;
  return typeof msg === 'string' ? msg : fallback;
}
