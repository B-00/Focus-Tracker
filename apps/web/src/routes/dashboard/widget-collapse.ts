import { useSyncExternalStore } from 'react';
import type { WidgetId } from './widget-order';

// Per-widget collapse state for the dashboard. Each widget owns a
// show/hide toggle in its header (matches the pattern on the Tasks
// consistency section — TopOfTasksCharts.tsx).
//
// Local-only; not synced to the server like widget-order is. Dashboard
// composition (which widgets exist + their order) is the shared identity
// across devices; "I folded this card up on my laptop right now" is a
// per-browser view preference, not an account preference. If the next
// device wants the card folded too, one click gets them there.
//
// ponytail: single JSON blob of collapsed IDs in localStorage. Migrating
// to server-sync later is a two-file change (add to UserDashboardPrefs,
// hydrate here) with no refactor of the widget call-sites.

const STORAGE_KEY = 'ft:widget-collapsed:v1';

function loadLocal(): Set<WidgetId> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is WidgetId => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

let collapsedIds: Set<WidgetId> = loadLocal();
const listeners = new Set<() => void>();

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedIds]));
  } catch {
    /* ignore — in-memory state still updates for this session */
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlySet<WidgetId> {
  return collapsedIds;
}

/// Toggle this widget's collapsed state. Swaps the Set reference so
/// useSyncExternalStore sees a new snapshot identity.
export function toggleWidgetCollapsed(id: WidgetId): void {
  const next = new Set(collapsedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds = next;
  persist();
  emit();
}

export function useWidgetCollapsed(id: WidgetId): boolean {
  const set = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return set.has(id);
}
