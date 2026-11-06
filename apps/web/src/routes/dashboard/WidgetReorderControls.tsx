import type { MouseEvent } from 'react';
import {
  moveWidgetDown,
  moveWidgetUp,
  useWidgetOrder,
  type WidgetId,
} from './widget-order';

// Tiny up/down arrow pair each widget drops into its header. Looks up
// its own position in the shared order store so the parent doesn't
// have to thread first/last props through.
//
// Dead-simple reorder instead of drag-and-drop: zero new dependency,
// keyboard-accessible out of the box (native <button>), works on
// touch + mouse identically. Drag-and-drop was overkill for a five-
// widget stack.

interface Props {
  id: WidgetId;
}

export function WidgetReorderControls({ id }: Props) {
  const order = useWidgetOrder();
  const i = order.indexOf(id);
  const isFirst = i <= 0;
  const isLast = i < 0 || i >= order.length - 1;

  // stopPropagation because BacklogIndicatorWidget nests its whole
  // body inside a <Link> — without this, clicking the arrows would
  // also fire a navigation to /backlog.
  const handle = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <div className="inline-flex items-center gap-0.5 text-neutral-600">
      <button
        type="button"
        onClick={handle(() => moveWidgetUp(id))}
        disabled={isFirst}
        aria-label="Move widget up"
        title="Move up"
        className="rounded px-1 text-xs leading-none transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
      >
        ▲
      </button>
      <button
        type="button"
        onClick={handle(() => moveWidgetDown(id))}
        disabled={isLast}
        aria-label="Move widget down"
        title="Move down"
        className="rounded px-1 text-xs leading-none transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
      >
        ▼
      </button>
    </div>
  );
}
