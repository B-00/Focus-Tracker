// "Paired" popup screen — today's browsing at a glance.
//
// Reads:
//   * daily rollup → today's per-domain totals (see ../storage/rollup.ts)
//   * currentFocus → live "on X right now" interpolation
//   * paused pref  → grays out the header + toggles button label
//   * health       → API-reachability pill in the header
//
// The rollup accumulates on every focus_change close-out, but the tab
// the user is on RIGHT NOW hasn't emitted its close-out yet — its time
// would be missing from the totals. `interpolateCurrentFocus()` adds
// `(now − startedAt)` for that domain and re-sorts, so the number the
// user sees matches the reality of "I've been on youtube for 30 min."
// A 1-second interval keeps the display counting up while the popup
// is open.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { probeHealth } from '../api/telemetry';
import type { PairedDevice } from '../storage/device';
import { getApiBaseUrl } from '../storage/device';
import {
  getHealth,
  isStale,
  setHealth,
  type HealthStatus,
} from '../storage/health';
import {
  getPreferences,
  setPaused,
  subscribePreferences,
  type Preferences,
} from '../storage/preferences';
import { getSnapshot, type DomainTotal, type RollupSnapshot } from '../storage/rollup';
import { readPersistedCurrentFocus } from '../background/state';
import { Donut } from './Donut';
import { OTHER_COLOR, PALETTE } from './palette';

const TOP_N = 5;
const LIVE_TICK_MS = 1000;

interface StatsViewProps {
  device: PairedDevice;
}

interface LiveFocus {
  domain: string;
  startedAt: Date;
}

export function StatsView({ device }: StatsViewProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<RollupSnapshot | null>(null);
  const [liveFocus, setLiveFocus] = useState<LiveFocus | null>(null);
  const [prefs, setPrefs] = useState<Preferences>({ paused: false });
  const [health, setHealthState] = useState<HealthStatus | 'checking' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ─── one-shot loads on mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getSnapshot(),
      readPersistedCurrentFocus(),
      getPreferences(),
      getHealth(),
    ]).then(([snap, focus, p, h]) => {
      if (cancelled) return;
      setSnapshot(snap);
      setLiveFocus(
        focus === null
          ? null
          : { domain: focus.target.domain, startedAt: focus.startedAt },
      );
      setPrefs(p);
      setHealthState(h);
      // If the stored reachability is missing/stale, kick off a fresh
      // HEAD probe so the pill isn't blank on first open.
      if (isStale(h)) {
        setHealthState('checking');
        void probeHealth().then((probe) => {
          if (cancelled) return;
          const fresh: HealthStatus = {
            reachable: probe.reachable,
            checkedAt: new Date().toISOString(),
            ...(probe.message !== undefined ? { message: probe.message } : {}),
          };
          void setHealth(fresh);
          setHealthState(fresh);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── live-tick for the current-focus interpolation ───────────────────
  useEffect(() => {
    if (liveFocus === null || prefs.paused) return;
    const id = window.setInterval(() => setNow(Date.now()), LIVE_TICK_MS);
    return () => window.clearInterval(id);
  }, [liveFocus?.domain, liveFocus?.startedAt.getTime(), prefs.paused]);

  // ─── react to background pref changes (e.g. pause via keyboard shortcut) ─
  useEffect(() => subscribePreferences(setPrefs), []);

  // ─── derived view ────────────────────────────────────────────────────
  const view = useMemo(() => {
    if (snapshot === null) return null;
    const interpolated = interpolateCurrentFocus(
      snapshot.totals,
      liveFocus,
      prefs.paused ? 0 : now,
    );
    const grandTotalMs = interpolated.reduce((sum, t) => sum + t.durationMs, 0);
    const top = interpolated.slice(0, TOP_N);
    const restMs = interpolated.slice(TOP_N).reduce((sum, t) => sum + t.durationMs, 0);
    return { top, restMs, grandTotalMs };
  }, [snapshot, liveFocus, now, prefs.paused]);

  const togglePaused = async (): Promise<void> => {
    const next = !prefs.paused;
    setPrefs({ ...prefs, paused: next });
    await setPaused(next);
  };

  return (
    <div class={`stats ${prefs.paused ? 'stats--paused' : ''}`}>
      <header class="stats__header">
        <span class="stats__label">
          <span class={`stats__pip ${prefs.paused ? 'stats__pip--paused' : 'stats__pip--live'}`} />
          {prefs.paused ? 'Paused' : 'Live'} · {device.label}
        </span>
        <HealthPill status={health} />
      </header>

      {snapshot === null ? (
        <div class="stats__loading">Loading…</div>
      ) : view!.grandTotalMs === 0 ? (
        <div class="stats__empty">
          <p>No browsing tracked yet today.</p>
          <p class="stats__empty-hint">
            Switch a few tabs — activity shows up here after the first close-out.
          </p>
        </div>
      ) : (
        <>
          <div class="stats__chart">
            <Donut segments={view!.top} totalMs={view!.grandTotalMs} />
          </div>
          <p class="stats__total">
            Today · <strong>{formatDuration(view!.grandTotalMs)}</strong> tracked
          </p>

          <ul class="stats__list">
            {view!.top.map((row, i) => (
              <li key={row.domain} class="stats__row">
                <span class="stats__dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span class="stats__domain">{row.domain}</span>
                <span class="stats__pct">{formatPct(row.durationMs, view!.grandTotalMs)}</span>
                <span class="stats__dur">{formatDuration(row.durationMs)}</span>
              </li>
            ))}
            {view!.restMs > 0 && (
              <li class="stats__row">
                <span class="stats__dot" style={{ background: OTHER_COLOR }} />
                <span class="stats__domain">Other</span>
                <span class="stats__pct">{formatPct(view!.restMs, view!.grandTotalMs)}</span>
                <span class="stats__dur">{formatDuration(view!.restMs)}</span>
              </li>
            )}
          </ul>
        </>
      )}

      <footer class="stats__footer">
        <button class="stats__btn" onClick={togglePaused} type="button">
          {prefs.paused ? 'Resume' : 'Pause'}
        </button>
        <button class="stats__btn" onClick={openDashboard} type="button">
          Open dashboard
        </button>
      </footer>
    </div>
  );
}

function HealthPill({
  status,
}: {
  status: HealthStatus | 'checking' | null;
}): JSX.Element | null {
  if (status === null) return null;
  if (status === 'checking') {
    return <span class="stats__health stats__health--checking">checking API…</span>;
  }
  if (status.reachable) return null; // no news is good news; keep the header uncluttered
  return (
    <span class="stats__health stats__health--down" title={status.message ?? ''}>
      API unreachable
    </span>
  );
}

/**
 * Adds the currently-in-flight focus's live duration to today's rollup.
 * Returns a fresh array so the sort stays stable across renders. If the
 * current domain is already in the totals, its entry is bumped; otherwise
 * a new entry is added. When the extension is paused, `nowMs === 0` and
 * the addition is a no-op — the display freezes on the last close-out.
 */
function interpolateCurrentFocus(
  totals: DomainTotal[],
  live: LiveFocus | null,
  nowMs: number,
): DomainTotal[] {
  if (live === null || nowMs === 0) return totals;
  const extra = Math.max(0, nowMs - live.startedAt.getTime());
  if (extra === 0) return totals;
  const idx = totals.findIndex((t) => t.domain === live.domain);
  const bumped =
    idx === -1
      ? [...totals, { domain: live.domain, durationMs: extra }]
      : totals.map((t, i) => (i === idx ? { ...t, durationMs: t.durationMs + extra } : t));
  return bumped.sort((a, b) => b.durationMs - a.durationMs);
}

async function openDashboard(): Promise<void> {
  // Rewrite the API base to the dev-web-app URL if it looks local. In
  // production the web app and API share an origin so the base is the
  // same. Same convention the desktop client uses (`open_dashboard` in
  // apps/desktop/src-tauri/src/commands.rs).
  const base = await getApiBaseUrl();
  const url = base
    .replace('localhost:3000', '127.0.0.1:5173')
    .replace('127.0.0.1:3000', '127.0.0.1:5173');
  await browser.tabs.create({ url });
  // The popup auto-closes on any tabs.create call, which is what we want.
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function formatPct(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}
