import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../../lib/api';
import { resetWidgetOrder } from '../dashboard/widget-order';

// /settings#about — minimal informational panel + the "nuke my dashboard
// prefs" escape hatch (Settings.md §4.6).
//
// ponytail: the web app version here is a build-time constant exposed
// via VITE_APP_VERSION. Falls back to "dev" when unset so local pnpm
// dev still renders a value. Upgrade path for a real git hash: wire
// `define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(gitSha) }`
// into vite.config.ts.

const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';

const REPO_URL = 'https://github.com/B-00/Focus-Tracker';

export function AboutSection() {
  // One-shot: no polling. uptime is useful but doesn't need to tick live.
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 60_000,
  });

  function handleResetAll(): void {
    // Spec §4.6: only resets dashboard prefs + the timezone-override flag.
    // The latter lives on the server and will self-heal on next login's
    // tz auto-detect (ProfileSection §4.1.1), so we don't touch it here.
    //
    // Does NOT delete milestones, devices, telemetry, or any user data.
    const ok = window.confirm(
      'Reset all preferences to defaults? Dashboard widget order, hidden widgets, and collapsed-state will all be reset. Your tasks, milestones, devices, and telemetry are not touched.',
    );
    if (!ok) return;
    resetWidgetOrder();
    // Visibility + collapse state are stored local-only; clear directly.
    try {
      window.localStorage.removeItem('ft:widget-hidden:v1');
      window.localStorage.removeItem('ft:widget-collapsed:v1');
    } catch {
      /* ignore — storage disabled; nothing to clear */
    }
    // Force a reload so every useSyncExternalStore reader re-reads from
    // the cleared storage and the dashboard re-renders with defaults.
    window.location.reload();
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">About</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Version info and a reset escape hatch.
        </p>
      </header>

      <dl className="divide-y divide-neutral-800 rounded-md border border-neutral-800 bg-neutral-950/40">
        <Row label="Web app version" value={APP_VERSION} />
        <Row
          label="Server version"
          value={
            healthQuery.isLoading
              ? 'Loading…'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data?.apiVersion ?? 'Unknown')
          }
        />
        <Row
          label="Server uptime"
          value={
            healthQuery.isLoading
              ? 'Loading…'
              : healthQuery.isError
                ? 'Unavailable'
                : formatUptime(healthQuery.data?.uptime ?? 0)
          }
        />
        <Row
          label="Source"
          value={
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:text-emerald-300"
            >
              GitHub ↗
            </a>
          }
        />
        <Row label="License" value="Personal project — not yet licensed" />
      </dl>

      <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
        <h3 className="text-sm font-semibold text-red-300">Danger zone</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Reset dashboard widget order, hidden widgets, and collapsed-state
          back to their defaults. Your tasks, milestones, devices, and telemetry
          are NOT touched.
        </p>
        <button
          type="button"
          onClick={handleResetAll}
          className="mt-3 rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          Reset all preferences to defaults
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="font-mono text-xs text-neutral-200">{value}</dd>
    </div>
  );
}

/// Format seconds-since-start into a compact duration string.
/// e.g. 125 → "2m 5s", 3665 → "1h 1m 5s".
function formatUptime(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor((seconds / 3600) % 24);
  const d = Math.floor(seconds / 86400);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
