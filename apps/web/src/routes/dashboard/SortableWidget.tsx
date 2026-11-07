import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { WidgetId } from './widget-order';

// SortableWidget wraps one dashboard widget in an @dnd-kit/sortable item
// and exposes the drag-handle wiring (attributes + listeners + activator
// ref) to its descendants via React Context. That way each widget's
// header can drop a <WidgetDragHandle /> in the same spot the old ▲/▼
// pair lived, without threading dnd props through every widget.
//
// ponytail: context instead of prop-drilling through 9 widgets. The
// alternative (every WidgetId-aware widget calling useSortable itself
// and knowing it's inside a Dashboard) couples widgets to a surface they
// otherwise don't care about.

interface HandleCtx {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  setActivatorNodeRef: (el: HTMLElement | null) => void;
  isDragging: boolean;
}

const DragHandleContext = createContext<HandleCtx | null>(null);

interface Props {
  id: WidgetId;
  children: ReactNode;
}

export function SortableWidget({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Keep the dragged card visible but obviously "in motion".
    opacity: isDragging ? 0.6 : 1,
    // z-index so the dragged card paints above its siblings.
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={style}>
      <DragHandleContext.Provider
        value={{ attributes, listeners, setActivatorNodeRef, isDragging }}
      >
        {children}
      </DragHandleContext.Provider>
    </div>
  );
}

// Drops in wherever WidgetReorderControls used to live. Reads its wiring
// from context, so it only works inside a <SortableWidget>. Outside one,
// renders nothing — safe to leave in widget source even if the widget
// gets rendered on a non-sortable surface later.
//
// Accessibility: dnd-kit's KeyboardSensor binds Space (pick up) / arrow
// keys (move) / Space again (drop) / Esc (cancel) to the activator node
// automatically via the spread `attributes` + `listeners`.
export function WidgetDragHandle() {
  const ctx = useContext(DragHandleContext);
  if (!ctx) return null;
  return (
    <button
      type="button"
      ref={ctx.setActivatorNodeRef}
      {...ctx.attributes}
      {...ctx.listeners}
      aria-label="Drag to reorder widget"
      title="Drag to reorder"
      className="inline-flex cursor-grab touch-none items-center rounded px-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:cursor-grabbing"
    >
      <GripVertical size={14} />
    </button>
  );
}
