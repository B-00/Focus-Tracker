import { useSyncExternalStore } from 'react';

// Dashboard widget order — user-local, localStorage-backed, shared via
// a tiny module-level store so the Dashboard, each widget's reorder
// arrows, and any future prefs UI all read the same source of truth.
//
// ponytail: same pattern as priority-colors.ts. Not synced across
// devices. Upgrade path (Dashboard.md §5-6 UserDashboardPrefs) is to
// swap this storage layer for a server round-trip — the hook contract
// stays the same.

export const WIDGET_IDS = [
  'today_tasks',
  'today_routines',
  'ongoing_tasks',
  'backlog',
  'today_activity',
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

/// Default order matches the user's preferred "action-first" stack:
/// today's actionable task lists at the top, trend / activity signal
/// at the bottom. Overridable per-user via moveWidgetUp/Down.
export const DEFAULT_ORDER: readonly WidgetId[] = [
  'today_tasks',
  'today_routines',
  'ongoing_tasks',
  'backlog',
  'today_activity',
];

const STORAGE_KEY = 'ft:widget-order:v1';

function load(): WidgetId[] {
  if (typeof window === 'undefined') return [...DEFAULT_ORDER];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER];
    // Keep only known IDs (filters out a stored old ID we no longer
    // ship), then append any new IDs not yet in storage. Means adding
    // a widget in code "just works" without wiping saved prefs.
    const known = new Set<WidgetId>(WIDGET_IDS);
    const seen = new Set<WidgetId>();
    const cleaned: WidgetId[] = [];
    for (const v of parsed) {
      if (typeof v === 'string' && known.has(v as WidgetId) && !seen.has(v as WidgetId)) {
        cleaned.push(v as WidgetId);
        seen.add(v as WidgetId);
      }
    }
    for (const id of WIDGET_IDS) if (!seen.has(id)) cleaned.push(id);
    return cleaned;
  } catch {
    return [...DEFAULT_ORDER];
  }
}

let state: WidgetId[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled — in-memory state still updates for this session.
  }
}

function emit() {
  for (const l of listeners) l();
}

/// Swap `id` with the widget above it. No-op if it's already first.
export function moveWidgetUp(id: WidgetId) {
  const i = state.indexOf(id);
  if (i <= 0) return;
  const next = state.slice();
  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
  state = next;
  persist();
  emit();
}

/// Swap `id` with the widget below it. No-op if it's already last.
export function moveWidgetDown(id: WidgetId) {
  const i = state.indexOf(id);
  if (i < 0 || i >= state.length - 1) return;
  const next = state.slice();
  [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
  state = next;
  persist();
  emit();
}

export function resetWidgetOrder() {
  state = [...DEFAULT_ORDER];
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ditto
  }
  emit();
}

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
