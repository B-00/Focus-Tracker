import { BacklogIndicatorWidget } from './dashboard/BacklogIndicatorWidget';
import { OngoingTasksWidget } from './dashboard/OngoingTasksWidget';
import { TodayActivityWidget } from './dashboard/TodayActivityWidget';
import { TodayTasksWidget } from './dashboard/TodayTasksWidget';

// Dashboard = composition surface (Dashboard.md §3). The dashboard owns
// zero feature behaviour; it just renders widgets from feature specs in
// a vertical stack.
//
// Current v1 stack (default order roughly matches Dashboard.md §4.2 —
// action-first at top, trend signals below, conditional backlog where
// it can't grab attention when empty):
//
//   1. Today's tasks       — dated + routine instances scheduled today
//   2. Today's activity    — hourly silhouette + top apps/sites
//   3. Ongoing tasks       — incomplete, priority-sorted
//   4. Backlog indicator   — conditional, hidden when backlog is empty
//
// Widget reorder/hide/collapse prefs (Dashboard.md §5-6), the focus
// session card, consistency charts, and Memento Mori land in later
// slices. Each widget is self-contained — adding/removing one is a
// single-line change here.

export function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-4 px-6 py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          The widgets you see here are customisable in Settings (coming soon).
        </p>
      </header>

      <TodayTasksWidget />
      <TodayActivityWidget />
      <OngoingTasksWidget />
      <BacklogIndicatorWidget />
    </main>
  );
}
