import { TodayActivityWidget } from './dashboard/TodayActivityWidget';

// Placeholder dashboard. Real widget layout will land with the Dashboard
// feature (Dashboard.md). For now we mount the first real widget —
// "Today's activity" — so the dashboard reflects live telemetry instead
// of an API-health ping. Future widgets (Focus Session control, Tasks
// glance, Memento Mori mini, etc.) slot in alongside it.
//
// Sign-out has moved to the AppShell header (so it's reachable from any
// route, not just /). Per Settings.md §4.1 the canonical home for sign-out
// is also Settings → Profile; both call the same code path.

export function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          The widgets you see here are customisable in Settings (coming soon).
        </p>
      </header>

      <TodayActivityWidget />
    </main>
  );
}
