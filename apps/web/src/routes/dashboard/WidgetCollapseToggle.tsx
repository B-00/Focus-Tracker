import type { MouseEvent } from 'react';
import { toggleWidgetCollapsed, useWidgetCollapsed } from './widget-collapse';
import type { WidgetId } from './widget-order';

// "▼ Show" / "▲ Hide" button that mirrors the Tasks page's consistency
// collapse (TopOfTasksCharts.tsx). Each dashboard widget drops this
// into its header next to WidgetDragHandle; the body is gated on
// `useWidgetCollapsed(id)` in the widget itself.
//
// ponytail: separate component (vs inlining) so the aria-controls id,
// the glyphs, and the hover styling stay in one place — hard to drift.

interface Props {
  id: WidgetId;
  /// Optional — the id of the element the button expands/collapses so
  /// screen readers can announce it correctly.
  controlsId?: string;
}

export function WidgetCollapseToggle({ id, controlsId }: Props) {
  const collapsed = useWidgetCollapsed(id);

  // stopPropagation — BacklogIndicatorWidget wraps its body in a <Link>,
  // so without this a click on the toggle would also navigate away.
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWidgetCollapsed(id);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      title={collapsed ? 'Expand widget' : 'Collapse widget'}
      className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
    >
      {collapsed ? '▼ Show' : '▲ Hide'}
    </button>
  );
}
