// Self-check for StatsView's `interpolateCurrentFocus` helper.
//
// The helper is small but it's the whole point of the live-interpolation
// feature — if it silently drops the current focus, the popup lies about
// today's totals in a way that's easy to miss (the numbers look fine,
// they're just under-counting).
//
// Re-implemented here (mirrors the copy in StatsView.tsx) to keep this
// file free of Preact / browser globals so `node --experimental-strip-types`
// can run it directly.
//
// Run: `node --experimental-strip-types apps/extension/src/popup/interpolate.check.ts`

import { strict as assert } from 'node:assert';

interface DomainTotal {
  domain: string;
  durationMs: number;
}

interface LiveFocus {
  domain: string;
  startedAt: Date;
}

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

// ─── cases ─────────────────────────────────────────────────────────────

// 1. Live focus already in totals → its bar grows.
{
  const totals: DomainTotal[] = [
    { domain: 'github.com', durationMs: 60_000 },
    { domain: 'news.ycombinator.com', durationMs: 30_000 },
  ];
  const live: LiveFocus = { domain: 'github.com', startedAt: new Date(1_000) };
  const out = interpolateCurrentFocus(totals, live, 31_000); // +30s to github
  assert.equal(out[0]!.domain, 'github.com');
  assert.equal(out[0]!.durationMs, 90_000);
  assert.equal(out[1]!.durationMs, 30_000);
}

// 2. Live focus NOT in totals → new row appears and re-sorts.
{
  const totals: DomainTotal[] = [
    { domain: 'github.com', durationMs: 60_000 },
  ];
  const live: LiveFocus = { domain: 'youtube.com', startedAt: new Date(0) };
  const out = interpolateCurrentFocus(totals, live, 120_000); // +2min on youtube
  assert.equal(out[0]!.domain, 'youtube.com');
  assert.equal(out[0]!.durationMs, 120_000);
  assert.equal(out[1]!.domain, 'github.com');
}

// 3. Sort is stable after interpolation — biggest first.
{
  const totals: DomainTotal[] = [
    { domain: 'a.com', durationMs: 100 },
    { domain: 'b.com', durationMs: 50 },
    { domain: 'c.com', durationMs: 200 },
  ];
  const live: LiveFocus = { domain: 'b.com', startedAt: new Date(0) };
  const out = interpolateCurrentFocus(totals, live, 500); // b jumps to 550
  assert.deepEqual(out.map((t) => t.domain), ['b.com', 'c.com', 'a.com']);
}

// 4. Paused → nowMs=0 sentinel → totals pass through unchanged.
{
  const totals: DomainTotal[] = [{ domain: 'a.com', durationMs: 100 }];
  const live: LiveFocus = { domain: 'a.com', startedAt: new Date(0) };
  const out = interpolateCurrentFocus(totals, live, 0);
  assert.equal(out, totals); // identity: no allocation on the paused fast-path
}

// 5. No live focus → totals pass through unchanged.
{
  const totals: DomainTotal[] = [{ domain: 'a.com', durationMs: 100 }];
  const out = interpolateCurrentFocus(totals, null, 999_999);
  assert.equal(out, totals);
}

// 6. Negative delta (clock skew across processes) → clamped to zero, no bump.
{
  const totals: DomainTotal[] = [{ domain: 'a.com', durationMs: 100 }];
  const live: LiveFocus = { domain: 'a.com', startedAt: new Date(2_000) };
  const out = interpolateCurrentFocus(totals, live, 1_000);
  assert.equal(out, totals);
}

console.log('interpolate self-check: all assertions passed');
