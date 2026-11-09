import { useEffect, useRef, useState } from 'react';
import type { TaskPriority } from '@focus-tracker/shared';
import {
  DEFAULT_PRIORITY_ICONS,
  iconFor,
  PRIORITY_ICON_CHOICES,
  resetPriorityIcons,
  setPriorityIcon,
  usePriorityIcons,
} from './priority-icons';

// Priority icon picker. Same rail shape as Priority colors — one row
// per priority, click the glyph to open a Lucide palette.

const ROWS: { priority: TaskPriority; label: string }[] = [
  { priority: 'extreme', label: 'Extreme' },
  { priority: 'high', label: 'High' },
  { priority: 'mid', label: 'Mid' },
  { priority: 'low', label: 'Low' },
];

export function PriorityIconPicker() {
  const icons = usePriorityIcons();
  const [openFor, setOpenFor] = useState<TaskPriority | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const isDirty = ROWS.some(
    ({ priority }) => icons[priority] !== DEFAULT_PRIORITY_ICONS[priority],
  );

  useEffect(() => {
    if (!openFor) return;
    function onDoc(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) setOpenFor(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenFor(null);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [openFor]);

  return (
    <section
      ref={rootRef}
      className="relative w-fit rounded border border-neutral-800 bg-neutral-900/40 p-3"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-neutral-300">
          Priority icons
        </h2>
        {isDirty && (
          <button
            type="button"
            onClick={() => {
              resetPriorityIcons();
              setOpenFor(null);
            }}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
          >
            Reset
          </button>
        )}
      </header>

      <ul
        className="flex flex-row gap-2 xl:flex-col xl:gap-1.5"
        role="group"
        aria-label="Task priority icons"
      >
        {ROWS.map(({ priority, label }) => {
          const Icon = iconFor(icons[priority]);
          const open = openFor === priority;
          return (
            <li
              key={priority}
              className="flex w-16 flex-col items-center gap-1 xl:w-auto xl:flex-row xl:gap-2"
            >
              <button
                type="button"
                onClick={() => setOpenFor(open ? null : priority)}
                aria-expanded={open}
                aria-label={`Pick icon for ${label} priority`}
                title={`Pick icon for ${label}`}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-neutral-700 bg-neutral-950 text-neutral-200 hover:border-neutral-500 ${
                  open ? 'ring-1 ring-emerald-400' : ''
                }`}
              >
                <Icon size={12} strokeWidth={2.25} />
              </button>
              <span className="whitespace-nowrap text-xs text-neutral-400">
                {label}
              </span>
            </li>
          );
        })}
      </ul>

      {openFor && (
        <div
          role="listbox"
          aria-label={`Icons for ${openFor} priority`}
          className="absolute left-0 top-full z-20 mt-1 grid w-44 grid-cols-5 gap-0.5 rounded-md border border-neutral-700 bg-neutral-950 p-1.5 shadow-xl"
        >
          {PRIORITY_ICON_CHOICES.map(({ name, Icon, label }) => {
            const selected = icons[openFor] === name;
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={selected}
                title={label}
                onClick={() => {
                  setPriorityIcon(openFor, name);
                  setOpenFor(null);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded text-neutral-200 hover:bg-neutral-800 ${
                  selected ? 'bg-emerald-500/15 text-emerald-200' : ''
                }`}
              >
                <Icon size={14} strokeWidth={2.25} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
