import { useEffect, useRef } from 'react';
import { WIDGET_IDS, WIDGET_LABELS, type WidgetId } from './widget-order';
import { toggleWidgetVisible, useHiddenWidgets } from './widget-visibility';

// Dropdown that lists every widget the dashboard knows about with a
// checkbox on its left. Checking a box shows the widget; unchecking it
// hides. State persists via widget-visibility.ts.
//
// ponytail: built on native <details> + <summary>. No popover library,
// no focus-trap gymnastics — the browser handles toggle + keyboard
// activation out of the box. Click a checkbox and the menu stays open
// (native <details> behaviour), which is what you want for bulk
// toggling a stack of widgets. One small bit of JS: a document-level
// mousedown listener that closes the <details> when the click lands
// outside it, matching the dismiss-on-outside-click expectation of a
// popover without pulling in a popover library.

export function WidgetVisibilityMenu() {
  const hidden = useHiddenWidgets();
  const visibleCount = WIDGET_IDS.length - hidden.size;
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Close on outside click. Idle work when closed: one bounds check
  // per mousedown anywhere in the document, which is cheap. Mounted
  // once per DashboardPage; torn down on unmount.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = detailsRef.current;
      if (!el || !el.open) return;
      if (el.contains(e.target as Node)) return;
      el.open = false;
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className="mt-1 inline-flex cursor-pointer list-none items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 marker:hidden hover:bg-neutral-800 hover:text-neutral-200 [&::-webkit-details-marker]:hidden"
        title="Show or hide dashboard widgets"
      >
        <span>Widgets</span>
        <span className="text-neutral-600">({visibleCount}/{WIDGET_IDS.length})</span>
        <span aria-hidden="true" className="text-[0.6rem]">▾</span>
      </summary>
      <div
        role="group"
        aria-label="Dashboard widget visibility"
        className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-neutral-700 bg-neutral-900 p-2 shadow-lg"
      >
        <ul className="flex flex-col">
          {WIDGET_IDS.map((id) => (
            <WidgetVisibilityRow key={id} id={id} hidden={hidden.has(id)} />
          ))}
        </ul>
      </div>
    </details>
  );
}

function WidgetVisibilityRow({ id, hidden }: { id: WidgetId; hidden: boolean }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800">
        <input
          type="checkbox"
          checked={!hidden}
          onChange={() => toggleWidgetVisible(id)}
          className="h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
        />
        <span className="flex-1">{WIDGET_LABELS[id]}</span>
      </label>
    </li>
  );
}
