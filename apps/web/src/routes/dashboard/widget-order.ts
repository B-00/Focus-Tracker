import { useEffect, useSyncExternalStore } from 'react';
import {
  fetchDashboardPrefs,
  updateDashboardPrefs,
} from '../../lib/dashboard-prefs-api';

// Dashboard widget order — synced to the server via `UserDashboardPrefs`
// (Dashboard.md §9), with localStorage kept as a cheap first-paint cache so
// a hard refresh doesn't flash the default stack before the GET lands.
//
// Flow:
//   1. Module load: read localStorage synchronously → initial state. Instant
//      first paint, works offline, no flicker.
//   2. First `useWidgetOrder()` mount on a logged-in surface: hydrate from
//      the server once. If the server copy differs, overwrite local state +
//      cache. Multi-device sync in one network round-trip.
//   3. moveUp / moveDown / reset: update local state + cache synchronously
//      (optimistic UI stays snappy), then PUT in the background. If the PUT
//      fails we log and carry on — the next mutation will re-sync, and the
//      next hydrate on page reload will self-heal if the server copy
//      diverged in the meantime. Losing a reorder across devices in an
//      offline/error edge case is acceptable for a personal-project v1.
//
// ponytail: fire-and-forget writes. Upgrade path is a react-query mutation
// with rollback on error; that's overkill while there's exactly one writer
// (this store) per surface (only /dashboard).

export const WIDGET_IDS = [
  'today_tasks',
  'today_routines',
  'ongoing_tasks',
  'backlog',
  'routine_chart',
  'dated_chart',
  'today_activity',
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

/// Default order matches the user's preferred "action-first" stack:
/// today's actionable task lists at the top, consistency trends in
/// the middle, activity signal at the bottom. Overridable per-user
/// via moveWidgetUp/Down.
export const DEFAULT_ORDER: readonly WidgetId[] = [
  'today_tasks',
  'today_routines',
  'ongoing_tasks',
  'backlog',
  'routine_chart',
  'dated_chart',
  'today_activity',
];

const STORAGE_KEY = 'ft:widget-order:v1';

/// Reconcile a stored order against the current code-side `WIDGET_IDS`:
/// drop IDs we no longer ship, append IDs added since this user last saved.
/// Exported for the server-hydrate path and used by the localStorage reader.
function reconcile(order: readonly string[]): WidgetId[] {
  const known = new Set<WidgetId>(WIDGET_IDS);
  const seen = new Set<WidgetId>();
  const cleaned: WidgetId[] = [];
  for (const v of order) {
    if (known.has(v as WidgetId) && !seen.has(v as WidgetId)) {
      cleaned.push(v as WidgetId);
      seen.add(v as WidgetId);
    }
  }
  for (const id of WIDGET_IDS) if (!seen.has(id)) cleaned.push(id);
  return cleaned;
}

function loadLocal(): WidgetId[] {
  if (typeof window === 'undefined') return [...DEFAULT_ORDER];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER];
    return reconcile(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return [...DEFAULT_ORDER];
  }
}

let state: WidgetId[] = loadLocal();
const listeners = new Set<() => void>();

function persistLocal() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled — in-memory state still updates for this session.
  }
}

function pushToServer() {
  // Fire-and-forget. Any error is non-fatal; next hydrate will self-heal.
  updateDashboardPrefs({ widgetOrder: state }).catch((err: unknown) => {
    console.warn('[dashboard-prefs] PUT failed; local state kept', err);
  });
}

function emit() {
  for (const l of listeners) l();
}

/// Set internal state in a way that: reconciles against current IDs,
/// avoids an emit() churn when nothing actually changed, and persists both
/// local + remote on real changes. The `skipRemote` flag is used by the
/// server-hydrate path so we don't PUT right back what we just GET'd.
function applyOrder(next: readonly string[], opts: { skipRemote?: boolean } = {}) {
  const reconciled = reconcile(next);
  if (arraysEqual(reconciled, state)) return;
  state = reconciled;
  persistLocal();
  if (!opts.skipRemote) pushToServer();
  emit();
}

function arraysEqual(a: readonly WidgetId[], b: readonly WidgetId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
//  Public mutators — unchanged signatures (keeps WidgetReorderControls +
//  Dashboard.reset button working without refactor).
// ---------------------------------------------------------------------------

/// Swap `id` with the widget above it. No-op if it's already first.
export function moveWidgetUp(id: WidgetId) {
  const i = state.indexOf(id);
  if (i <= 0) return;
  const next = state.slice();
  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
  applyOrder(next);
}

/// Swap `id` with the widget below it. No-op if it's already last.
export function moveWidgetDown(id: WidgetId) {
  const i = state.indexOf(id);
  if (i < 0 || i >= state.length - 1) return;
  const next = state.slice();
  [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
  applyOrder(next);
}

export function resetWidgetOrder() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ditto
  }
  applyOrder(DEFAULT_ORDER);
}

// ---------------------------------------------------------------------------
//  React integration
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): readonly WidgetId[] {
  return state;
}

export function useWidgetOrder(): readonly WidgetId[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// Hydrate the store from the server exactly once per app session. Mount
/// from /dashboard (the only surface that reads widget order). Re-mounts are
/// cheap no-ops — the `hydrated` latch is module-level, not per-component.
let hydrated = false;
let hydrateInFlight: Promise<void> | null = null;

export function useHydrateDashboardPrefs() {
  useEffect(() => {
    if (hydrated || hydrateInFlight) return;
    hydrateInFlight = (async () => {
      try {
        const remote = await fetchDashboardPrefs();
        // Empty widgetOrder = fresh account, no server row yet — keep the
        // local/default order and let the next mutation push it up.
        if (remote.widgetOrder.length > 0) {
          applyOrder(remote.widgetOrder, { skipRemote: true });
        }
        hydrated = true;
      } catch (err: unknown) {
        // Non-fatal: localStorage already drove the first paint. Allow retry
        // on the next mount so a transient network blip doesn't strand us.
        console.warn('[dashboard-prefs] GET failed; using local state', err);
      } finally {
        hydrateInFlight = null;
      }
    })();
  }, []);
}
