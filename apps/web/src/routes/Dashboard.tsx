import { VacationButton } from '../components/VacationButton';
import type { ComponentType } from 'react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { BacklogIndicatorWidget } from './dashboard/BacklogIndicatorWidget';
import { DatedChartWidget } from './dashboard/DatedChartWidget';
import { FocusSessionWidget } from './dashboard/FocusSessionWidget';
import { LifeStripWidget } from './dashboard/LifeStripWidget';
import { OngoingTasksWidget } from './dashboard/OngoingTasksWidget';
import { RoutineChartWidget } from './dashboard/RoutineChartWidget';
import { SortableWidget } from './dashboard/SortableWidget';
import { TodayActivityWidget } from './dashboard/TodayActivityWidget';
import { TodayRoutinesWidget } from './dashboard/TodayRoutinesWidget';
import { TodayTasksWidget } from './dashboard/TodayTasksWidget';
import {
  DEFAULT_ORDER,
  reorderWidget,
  resetWidgetOrder,
  useHydrateDashboardPrefs,
  useWidgetOrder,
  type WidgetId,
} from './dashboard/widget-order';
import { useHiddenWidgets } from './dashboard/widget-visibility';
import { WidgetVisibilityMenu } from './dashboard/WidgetVisibilityMenu';

// Dashboard = composition surface (Dashboard.md §3). Owns zero feature
// behavior; it just renders widgets in whatever order the user has set.
//
// Reorder: each widget's header hosts a drag handle (<WidgetDragHandle />),
// wired via @dnd-kit/sortable. Drop → reorderWidget() → the shared
// widget-order store persists locally and PUTs the new order to the
// server (same pipe the old ▲/▼ buttons used). Keyboard a11y is free
// from dnd-kit's KeyboardSensor (Space pick / arrows move / Space drop).
//
// Adding a new widget is three steps: (1) implement the widget, (2) add
// its ID to WIDGET_IDS in widget-order.ts (auto-appends for existing
// users), (3) map the ID to the component in WIDGET_MAP below.

const WIDGET_MAP: Record<WidgetId, ComponentType> = {
  focus_session: FocusSessionWidget,
  today_tasks: TodayTasksWidget,
  today_routines: TodayRoutinesWidget,
  ongoing_tasks: OngoingTasksWidget,
  backlog: BacklogIndicatorWidget,
  routine_chart: RoutineChartWidget,
  dated_chart: DatedChartWidget,
  today_activity: TodayActivityWidget,
  life_strip: LifeStripWidget,
};

export function DashboardPage() {
  // Fire the server round-trip once per session to sync widget order across
  // devices. First paint still uses localStorage — see widget-order.ts for
  // the full flow.
  useHydrateDashboardPrefs();
  const order = useWidgetOrder();
  const hidden = useHiddenWidgets();
  const isCustomized = !isDefaultOrder(order);
  const visibleOrder = order.filter((id) => !hidden.has(id));

  // 4px activation distance so a click on a drag-handle button doesn't
  // misfire a drag; keyboard sensor gives arrow-key reorder for free.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderWidget(active.id as WidgetId, over.id as WidgetId);
  }

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Drag a widget by its handle to reorder.
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <VacationButton />
          {isCustomized && (
            <button
              type="button"
              onClick={resetWidgetOrder}
              className="mt-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              title="Restore default widget order"
            >
              Reset order
            </button>
          )}
          <WidgetVisibilityMenu />
        </div>
      </header>

      {visibleOrder.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950 px-4 py-6 text-center text-sm text-neutral-500">
          No widgets visible. Turn some back on from the Widgets menu above.
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {visibleOrder.map((id) => {
              const W = WIDGET_MAP[id];
              return (
                <SortableWidget key={id} id={id}>
                  <W />
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </main>
  );
}

// Cheap identity check: compare against the authoritative DEFAULT_ORDER
// constant so adding a widget in widget-order.ts doesn't silently
// de-sync this file.
function isDefaultOrder(order: readonly WidgetId[]): boolean {
  if (order.length !== DEFAULT_ORDER.length) return false;
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== DEFAULT_ORDER[i]) return false;
  }
  return true;
}
