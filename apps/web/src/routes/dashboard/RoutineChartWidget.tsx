import { Link } from '@tanstack/react-router';
import { ConsistencyChartBlock } from '../charts/ConsistencyChartBlock';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — global routine consistency chart (TaskCharts.md
// §3.4). Compact variant of the one at /tasks top: only 1M/3M pills
// and a smaller height to fit the dashboard column.

export function RoutineChartWidget() {
  return (
    <ConsistencyChartBlock
      title="Routine consistency"
      scope={{ kind: 'routine-global' }}
      height={160}
      compact
      headerRight={
        <div className="flex items-center gap-3">
          <WidgetReorderControls id="routine_chart" />
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
