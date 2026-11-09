import { useSyncExternalStore } from 'react';
import type { TaskPriority } from '@focus-tracker/shared';
import { isUiPrefPending, pushUiPref } from '../../lib/ui-prefs-api';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleDot,
  Diamond,
  Flag,
  Flame,
  Minus,
  Skull,
  Star,
  Triangle,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Per-user Lucide icon per priority, synced via `User.uiPrefs.priorityIcons`.
// Same store shape as priority-colors.ts (localStorage cache + server
// sync + useSyncExternalStore) so a pick
// in the Priority icons legend instantly repaints every badge, row,
// and calendar bar.
//
// ponytail: names are stored, not components — localStorage can't hold
// a function. The catalog below is the allow-list; unknown names on
// disk fall back to the default for that priority.

export const PRIORITY_ICON_CHOICES: { name: string; Icon: LucideIcon; label: string }[] = [
  { name: 'ChevronsUp', Icon: ChevronsUp, label: 'Double up' },
  { name: 'ChevronUp', Icon: ChevronUp, label: 'Up' },
  { name: 'ArrowUp', Icon: ArrowUp, label: 'Arrow up' },
  { name: 'Triangle', Icon: Triangle, label: 'Triangle' },
  { name: 'AlertTriangle', Icon: AlertTriangle, label: 'Alert' },
  { name: 'Flame', Icon: Flame, label: 'Flame' },
  { name: 'Zap', Icon: Zap, label: 'Zap' },
  { name: 'Star', Icon: Star, label: 'Star' },
  { name: 'Circle', Icon: Circle, label: 'Circle' },
  { name: 'CircleDot', Icon: CircleDot, label: 'Circle dot' },
  { name: 'CircleAlert', Icon: CircleAlert, label: 'Circle alert' },
  { name: 'Diamond', Icon: Diamond, label: 'Diamond' },
  { name: 'Flag', Icon: Flag, label: 'Flag' },
  { name: 'Minus', Icon: Minus, label: 'Minus' },
  { name: 'ChevronDown', Icon: ChevronDown, label: 'Down' },
  { name: 'ChevronsDown', Icon: ChevronsDown, label: 'Double down' },
  { name: 'ArrowDown', Icon: ArrowDown, label: 'Arrow down' },
  { name: 'Ban', Icon: Ban, label: 'Ban' },
  { name: 'Skull', Icon: Skull, label: 'Skull' },
];

const ICON_BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  PRIORITY_ICON_CHOICES.map(({ name, Icon }) => [name, Icon]),
);

export const DEFAULT_PRIORITY_ICONS: Record<TaskPriority, string> = {
  extreme: 'ChevronsUp',
  high: 'ChevronUp',
  mid: 'Circle',
  low: 'ChevronDown',
};

const STORAGE_KEY = 'ft:priority-icons:v1';

type Palette = Record<TaskPriority, string>;

function sanitize(name: string | undefined, fallback: string): string {
  if (name && ICON_BY_NAME[name]) return name;
  return fallback;
}

export function iconFor(name: string): LucideIcon {
  return ICON_BY_NAME[name] ?? Circle;
}

function sanitizeAll(parsed: Partial<Palette>): Palette {
  return {
    extreme: sanitize(parsed.extreme, DEFAULT_PRIORITY_ICONS.extreme),
    high: sanitize(parsed.high, DEFAULT_PRIORITY_ICONS.high),
    mid: sanitize(parsed.mid, DEFAULT_PRIORITY_ICONS.mid),
    low: sanitize(parsed.low, DEFAULT_PRIORITY_ICONS.low),
  };
}

function load(): Palette {
  if (typeof window === 'undefined') return { ...DEFAULT_PRIORITY_ICONS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PRIORITY_ICONS };
    return sanitizeAll(JSON.parse(raw) as Partial<Palette>);
  } catch {
    return { ...DEFAULT_PRIORITY_ICONS };
  }
}

let state: Palette = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function commit(next: Palette, push: boolean) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled / full — fail silent, in-memory still updates.
  }
  if (push) pushUiPref('priorityIcons', state);
  emit();
}

export function setPriorityIcon(priority: TaskPriority, name: string) {
  const next = sanitize(name, DEFAULT_PRIORITY_ICONS[priority]);
  if (state[priority] === next) return;
  commit({ ...state, [priority]: next }, true);
}

export function resetPriorityIcons() {
  commit({ ...DEFAULT_PRIORITY_ICONS }, true);
}

/// Apply the server copy (no echo PATCH). Missing on the server = first
/// sync from this browser, so upload the local picks instead.
export function hydratePriorityIcons(remote: Partial<Palette> | undefined) {
  if (isUiPrefPending('priorityIcons')) return;
  if (!remote) return pushUiPref('priorityIcons', state);
  commit(sanitizeAll(remote), false);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Palette {
  return state;
}

export function usePriorityIcons(): Palette {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

if (import.meta.env?.DEV) {
  for (const [p, name] of Object.entries(DEFAULT_PRIORITY_ICONS)) {
    if (!ICON_BY_NAME[name]) {
      // eslint-disable-next-line no-console
      console.warn('[priority-icons] default missing from catalog', p, name);
    }
  }
}
