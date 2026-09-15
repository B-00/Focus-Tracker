// Popup color identity — donut segments + top-N legend dots.
//
// Deliberately mirrors `apps/web/src/routes/activity/palette.ts` so the
// extension popup and the web dashboard's Top Sites donut share the same
// visual identity. If you change the palette in one place, update it in
// the other too — there's no runtime sharing.
// ponytail: 5 hex values duplicated across two apps beats setting up a
// design-tokens package for a personal project.

export const PALETTE = [
  '#f75590', // 1st  · pink
  '#2191fb', // 2nd  · blue
  '#fbd87f', // 3rd  · yellow
  '#8b5cf6', // 4th  · violet
  '#10ffcb', // 5th  · aqua
] as const;

/// Track ring / "Other" legend dot. Also used as the donut's "Other"
/// segment color.
export const OTHER_COLOR = 'rgba(181, 248, 254, 0.6)';
