import { Link } from '@tanstack/react-router';
import { ConsistencyChartBlock } from '../charts/ConsistencyChartBlock';
import { useWidgetCollapsed } from './widget-collapse';
import { WidgetCollapseToggle } from './WidgetCollapseToggle';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — global routine consistency chart (TaskCharts.md
// §3.4). Compact variant of the one at /tasks top: only 1M/3M pills
// and a smaller height to fit the dashboard column.

const BODY_ID = 'widget-routine-chart-body';

export function RoutineChartWidget() {
  const collapsed = useWidgetCollapsed('routine_chart');
  return (
    <ConsistencyChartBlock
      title="Routine consistency"
      scope={{ kind: 'routine-global' }}
      height={160}
      compact
      collapsed={collapsed}
      bodyId={BODY_ID}
      headerRight={
        <div className="flex items-center gap-3">
          <WidgetReorderControls id="routine_chart" />
          <WidgetCollapseToggle id="routine_chart" controlsId={BODY_ID} />
          <Link
            to="/tasks"
            className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Open tasks →
          </Link>
        </div>
      }
      emptyLabel="No routine data yet — add a routine, give it a few days."
    />
  );
}
