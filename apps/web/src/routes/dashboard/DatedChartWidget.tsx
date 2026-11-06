import { Link } from '@tanstack/react-router';
import { ConsistencyChartBlock } from '../charts/ConsistencyChartBlock';
import { WidgetReorderControls } from './WidgetReorderControls';

// Dashboard widget — global dated consistency chart (TaskCharts.md
// §3.4). Mirror of RoutineChartWidget with the dated series.

export function DatedChartWidget() {
  return (
    <ConsistencyChartBlock
      title="Dated consistency"
      scope={{ kind: 'dated-global' }}
      height={160}
      compact
      headerRight={
        <div className="flex items-center gap-3">
          <WidgetReorderControls id="dated_chart" />
          <Link
            to="/tasks"
            className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Open tasks →
          </Link>
        </div>
      }
      emptyLabel="No dated-task history yet — add a dated task with a due date."
    />
  );
}
