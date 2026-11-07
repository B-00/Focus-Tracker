// Milestones wire contracts (MementoMori.md §3.4 + §7).
//
// A Milestone is a user-defined annotation on a specific week of the
// life calendar — e.g. "Graduation", "First job", "Met partner",
// "Move to NYC", "Retirement (planned)". Past-week milestones are just
// as valid as future-week ones (spec §3.4).
//
// Wire shape mirrors the Prisma `Milestone` model one-for-one plus a
// server-computed `weekIndex` so the client can bin milestones by week
// without re-doing birthday math on every render.

import { z } from 'zod';

// ---------------------------------------------------------------------------
//  Constraints (shared with the service layer)
// ---------------------------------------------------------------------------

export const MILESTONE_LABEL_MAX = 60;
export const MILESTONE_ICON_MAX = 40;

/// Accepts #RGB, #RRGGBB, and #RRGGBBAA. Hex is case-insensitive. We
/// deliberately do NOT accept rgb() / hsl() / named colors — the grid-
/// marker renderer assumes a hex value it can drop directly into CSS.
export const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/// yyyy-mm-dd. Matches the shape used elsewhere in the API (User.birthday,
/// WeekActivityMinutes.computedAt-derived dates, etc.).
export const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
//  Response
// ---------------------------------------------------------------------------

export const milestoneSchema = z.object({
  id: z.string(),
  targetDate: z.string().regex(YMD_REGEX),
  /// Week-since-birthday index. Computed server-side so the client can
  /// bin milestones by week without carrying birthday math.
  weekIndex: z.number().int().nonnegative(),
  label: z.string().min(1).max(MILESTONE_LABEL_MAX),
  color: z.string().regex(HEX_COLOR_REGEX),
  icon: z.string().min(1).max(MILESTONE_ICON_MAX).nullable(),
  createdAt: z.string(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const milestoneListResponseSchema = z.array(milestoneSchema);
export type MilestoneListResponse = z.infer<typeof milestoneListResponseSchema>;

// ---------------------------------------------------------------------------
//  Requests
// ---------------------------------------------------------------------------

export const createMilestoneRequestSchema = z.object({
  targetDate: z.string().regex(YMD_REGEX),
  label: z.string().min(1).max(MILESTONE_LABEL_MAX),
  color: z.string().regex(HEX_COLOR_REGEX),
  icon: z.string().min(1).max(MILESTONE_ICON_MAX).nullable().optional(),
});
export type CreateMilestoneRequest = z.infer<typeof createMilestoneRequestSchema>;

/// PATCH — every field is optional, but at least one must be present.
/// The service throws `validation_failed` on an empty body; expressing
/// "non-empty object" in Zod is noisy, so we accept {} at the type
/// level and reject it in the service.
export const updateMilestoneRequestSchema = z.object({
  targetDate: z.string().regex(YMD_REGEX).optional(),
  label: z.string().min(1).max(MILESTONE_LABEL_MAX).optional(),
  color: z.string().regex(HEX_COLOR_REGEX).optional(),
  icon: z.string().min(1).max(MILESTONE_ICON_MAX).nullable().optional(),
});
export type UpdateMilestoneRequest = z.infer<typeof updateMilestoneRequestSchema>;

// ---------------------------------------------------------------------------
//  Errors (coded strings so the client can branch without parsing)
// ---------------------------------------------------------------------------

export const MILESTONE_ERROR_CODES = {
  not_found: 'milestone_not_found',
  birthday_not_set: 'birthday_not_set',
  invalid_date: 'invalid_date',
  empty_update: 'empty_update',
} as const;

export type MilestoneErrorCode =
  (typeof MILESTONE_ERROR_CODES)[keyof typeof MILESTONE_ERROR_CODES];

// ---------------------------------------------------------------------------
//  Runnable self-check (ponytail: single assert-based demo per the
//  user rule). Run with `node packages/shared/dist/milestones.js`.
// ---------------------------------------------------------------------------

/* v8 ignore start */
function selfCheck(): void {
  const assert = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(`milestones self-check: ${msg}`);
  };

  // Hex colour validation — the regex is the entire security boundary
  // for whatever we drop into a CSS style, so pin each shape.
  const ok = ['#fff', '#FFFFFF', '#ff00aa', '#FF00AA80'];
  for (const c of ok) assert(HEX_COLOR_REGEX.test(c), `${c} should parse`);
  const bad = ['#ff', '#ff00', 'rgb(255,0,0)', 'red', '#gggggg', '#1234567', ''];
  for (const c of bad) assert(!HEX_COLOR_REGEX.test(c), `${c} should NOT parse`);

  // Round-trip a full milestone + a nullable-icon variant.
  const full = milestoneSchema.parse({
    id: 'clmile1',
    targetDate: '2030-06-15',
    weekIndex: 2089,
    label: 'Graduation',
    color: '#34d399',
    icon: 'GraduationCap',
    createdAt: '2026-11-07T12:00:00.000Z',
  });
  assert(full.icon === 'GraduationCap', 'icon preserved');

  const noIcon = milestoneSchema.parse({
    ...full,
    icon: null,
  });
  assert(noIcon.icon === null, 'null icon preserved');

  // Create request — missing icon is OK (optional).
  const create = createMilestoneRequestSchema.parse({
    targetDate: '2027-01-01',
    label: 'New Year',
    color: '#f87171',
  });
  assert(create.icon === undefined, 'create icon default undefined');

  // Over-length label rejected.
  let threw = false;
  try {
    createMilestoneRequestSchema.parse({
      targetDate: '2027-01-01',
      label: 'x'.repeat(MILESTONE_LABEL_MAX + 1),
      color: '#000',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'over-length label rejected');

  // Invalid date shape rejected.
  threw = false;
  try {
    createMilestoneRequestSchema.parse({
      targetDate: '15/06/2030',
      label: 'x',
      color: '#000',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'non-yyyy-mm-dd date rejected');

  console.log('milestones: self-check OK');
}

declare const process: { argv?: string[] } | undefined;
if (
  typeof process !== 'undefined' &&
  (process.argv?.[1]?.endsWith('milestones.ts') ||
    process.argv?.[1]?.endsWith('milestones.js'))
) {
  selfCheck();
}
/* v8 ignore stop */
