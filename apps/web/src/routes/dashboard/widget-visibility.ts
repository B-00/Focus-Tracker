import { useSyncExternalStore } from 'react';
import type { WidgetId } from './widget-order';

// Per-widget visibility for the dashboard. A widget can be in one of
// three states:
//   - visible + expanded  (default)
//   - visible + collapsed (header strip only — see widget-collapse.ts)
//   - hidden              (not rendered at all — this module)
//
// Hidden widgets still keep their position in widget-order so that
// re-showing them restores their place in the stack.
//
// ponytail: local-only persistence like widget-collapse. Not synced to
// the server. Reasoning matches collapse: "which widgets I use on my
// laptop" is a per-device preference, same as "which ones I've folded
// up". Upgrade path if cross-device becomes a want: add `widgetHidden`
// to UserDashboardPrefs the same way widgetOrder is handled, hydrate
// here, done.

const STORAGE_KEY = 'ft:widget-hidden:v1';

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

let hiddenIds: Set<WidgetId> = loadLocal();
const listeners = new Set<() => void>();

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...hiddenIds]));
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
  return hiddenIds;
}

/// Flip this widget's visibility. Swap the Set reference so
/// useSyncExternalStore sees a new snapshot identity.
export function toggleWidgetVisible(id: WidgetId): void {
  const next = new Set(hiddenIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  hiddenIds = next;
  persist();
  emit();
}

export function useHiddenWidgets(): ReadonlySet<WidgetId> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
