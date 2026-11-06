import type { ComponentType } from 'react';
import { BacklogIndicatorWidget } from './dashboard/BacklogIndicatorWidget';
import { DatedChartWidget } from './dashboard/DatedChartWidget';
import { FocusSessionWidget } from './dashboard/FocusSessionWidget';
import { OngoingTasksWidget } from './dashboard/OngoingTasksWidget';
import { RoutineChartWidget } from './dashboard/RoutineChartWidget';
import { TodayActivityWidget } from './dashboard/TodayActivityWidget';
import { TodayRoutinesWidget } from './dashboard/TodayRoutinesWidget';
import { TodayTasksWidget } from './dashboard/TodayTasksWidget';
import {
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
// Each widget carries its own ▲/▼ reorder arrows in its header
// (WidgetReorderControls). The order lives in a shared store
// (widget-order.ts) so arrow clicks + localStorage persistence + the
// Dashboard's own render loop all read the same source.
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

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-4 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Reorder widgets with the ▲▼ arrows in each header.
          </p>
        </div>
        <div className="flex items-start gap-2">
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

      {visibleOrder.map((id) => {
        const W = WIDGET_MAP[id];
        return <W key={id} />;
      })}
    </main>
  );
}

// Cheap identity check: the default order is short enough that a
// position-by-position scan is less code than a Set diff.
function isDefaultOrder(order: readonly WidgetId[]): boolean {
  const defaultIds: WidgetId[] = [
    'focus_session',
    'today_tasks',
    'today_routines',
    'ongoing_tasks',
    'backlog',
    'routine_chart',
    'dated_chart',
    'today_activity',
  ];
  if (order.length !== defaultIds.length) return false;
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== defaultIds[i]) return false;
  }
  return true;
}
