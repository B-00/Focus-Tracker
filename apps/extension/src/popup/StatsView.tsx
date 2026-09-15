// "Paired" popup screen — today's browsing at a glance.
//
// Reads directly from the local IndexedDB outbox (no API dependency).
// Once Slice 4's flusher lands, this same data is also uploaded to the
// API, so eventually the web dashboard and this popup will agree — but
// the popup keeps working even offline or before the flusher has run.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Donut } from './Donut';
import { OTHER_COLOR, PALETTE } from './palette';
import type { PairedDevice } from '../storage/device';
import { getApiBaseUrl } from '../storage/device';
import { sumTodayByDomain, type DomainTotal } from '../storage/outbox';

const TOP_N = 5;

interface StatsViewProps {
  device: PairedDevice;
}

export function StatsView({ device }: StatsViewProps): JSX.Element {
  const [totals, setTotals] = useState<DomainTotal[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sumTodayByDomain().then((rows) => {
      if (!cancelled) setTotals(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    if (totals === null) return null;
    const grandTotalMs = totals.reduce((sum, t) => sum + t.durationMs, 0);
    const top = totals.slice(0, TOP_N);
    const restMs = totals.slice(TOP_N).reduce((sum, t) => sum + t.durationMs, 0);
    return { top, restMs, grandTotalMs };
  }, [totals]);

  return (
    <div class="stats">
      <header class="stats__header">
        <span class="stats__label">🟢 Live · {device.label}</span>
      </header>

      {totals === null ? (
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
        <button class="stats__btn" onClick={openDashboard}>
          Open dashboard
        </button>
      </footer>
    </div>
  );
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
