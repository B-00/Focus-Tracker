import { Link } from '@tanstack/react-router';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical } from 'lucide-react';
import {
  reorderWidget,
  resetWidgetOrder,
  useHydrateDashboardPrefs,
  useWidgetOrder,
  WIDGET_DESCRIPTIONS,
  WIDGET_LABELS,
  type WidgetId,
} from '../dashboard/widget-order';
import {
  toggleWidgetVisible,
  useHiddenWidgets,
} from '../dashboard/widget-visibility';

// /settings#dashboard — mirror of the inline reorder UI on /dashboard
// (Settings.md §4.3). Same backing store (widget-order.ts + widget-
// visibility.ts), same auto-save semantics (drop → applyOrder →
// pushToServer), rendered as a vertical list more friendly to keyboard
// and screen-reader use.
//
// ponytail: deviates from Settings.md §5 which prescribes an explicit
// "Save layout" button here. /dashboard already auto-saves on drop
// (that's how widget-order has shipped since Slice 1), so matching
// that behaviour here keeps the two surfaces behavioural twins — one
// mental model instead of two. Upgrade path if explicit-save is ever
// wanted: wrap applyOrder in a staged-vs-committed layer.

export function DashboardSection() {
  useHydrateDashboardPrefs();
  const order = useWidgetOrder();
  const hidden = useHiddenWidgets();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderWidget(active.id as WidgetId, over.id as WidgetId);
  }

  function handleReset() {
    if (window.confirm('Reset dashboard to default? This will undo your widget-order customizations.')) {
      resetWidgetOrder();
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Reorder widgets by dragging, or hide the ones you don't use. Changes sync across
          your devices. You can also{' '}
          <Link to="/" className="text-emerald-400 hover:text-emerald-300">
            reorder directly on the dashboard
          </Link>
          .
        </p>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order as WidgetId[]} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {order.map((id) => (
              <SortableRow key={id} id={id} hidden={hidden.has(id)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          title="Restore default widget order"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}

function SortableRow({ id, hidden }: { id: WidgetId; hidden: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 ${hidden ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${WIDGET_LABELS[id]} to reorder`}
        title="Drag to reorder"
        className="cursor-grab touch-none rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-100">
          {WIDGET_LABELS[id]}
        </p>
        <p className="truncate text-xs text-neutral-500">
          {WIDGET_DESCRIPTIONS[id]}
        </p>
      </div>

      <button
        type="button"
        onClick={() => toggleWidgetVisible(id)}
        aria-label={hidden ? `Show ${WIDGET_LABELS[id]}` : `Hide ${WIDGET_LABELS[id]}`}
        title={hidden ? 'Show widget' : 'Hide widget'}
        className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </li>
  );
}
