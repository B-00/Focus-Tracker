import { useSyncExternalStore } from 'react';
import { ConsistencyChartBlock } from '../../charts/ConsistencyChartBlock';

// Top-of-/tasks collapsible panel holding the two global consistency
// charts (TaskCharts.md §3.1 / §3.3). Routine + Dated stack vertically;
// user can collapse the whole panel to a header strip if the charts
// aren't what they're there for right now.
//
// Collapse state persists per-browser via localStorage (same pattern as
// widget-order / priority-colors) so it survives reloads.

const STORAGE_KEY = 'ft:tasks-charts-ui:v1';

interface UiState {
  collapsed: boolean;
}

function load(): UiState {
  if (typeof window === 'undefined') return { collapsed: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: false };
    const parsed = JSON.parse(raw) as Partial<UiState>;
    return { collapsed: parsed.collapsed === true };
  } catch {
    return { collapsed: false };
  }
}

let state: UiState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): UiState {
  return state;
}

function setCollapsed(next: boolean) {
  state = { ...state, collapsed: next };
  persist();
  emit();
}

export function TopOfTasksCharts() {
  const { collapsed } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Consistency
          </h2>
          <span className="text-xs text-neutral-600">
            Scores post nightly &middot; today in progress
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls="tasks-charts-body"
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
          title={collapsed ? 'Expand charts' : 'Collapse charts'}
        >
          {collapsed ? '▼ Show' : '▲ Hide'}
        </button>
      </header>
      {!collapsed && (
        <div id="tasks-charts-body" className="flex flex-col gap-3 px-4 pb-4 pt-1">
          <ConsistencyChartBlock
            title="Global routines"
            scope={{ kind: 'routine-global' }}
            emptyLabel="No routine data yet — add a routine, give it a few days."
          />
          <ConsistencyChartBlock
            title="Global dated"
            scope={{ kind: 'dated-global' }}
            emptyLabel="No dated-task history yet — add a dated task with a due date."
          />
        </div>
      )}
    </section>
  );
}
