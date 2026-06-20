// Shared color identity for the Top Apps / Top Sites donut, ranked list,
// and the per-kind stacked breakdown charts. Same index → same color
// across all three so the eye links them as one consistent group.
//
// Hex values ship as raw strings because Tailwind doesn't propagate
// dynamic class names into SVG `stroke` / inline `style` attributes —
// we paint segments and bars directly.

export const PALETTE = [
  '#f75590', // 1st  · pink
  '#2191fb', // 2nd  · blue
  '#fbd87f', // 3rd  · yellow
  '#8b5cf6', // 4th  · violet
  '#10ffcb', // 5th  · aqua
] as const;

/// Track ring / "Other" legend dot. Also used as the stacked-chart's
/// "Other" segment color so the chart's leftover-time band shares a
/// color identity with the donut's track ring and the bottom-of-list
/// legend entry. Same constant in three places = one concept.
export const OTHER_COLOR = 'rgba(181, 248, 254, 0.6)';
