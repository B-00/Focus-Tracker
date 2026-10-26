// Tasks + Sections wire contracts, shared by API and web.
//
// Owner: Tasks.md (feature spec), PROJECT.md §7 (API conventions),
// `apps/api/prisma/schema.prisma` (DB models).
//
// Slice 1 scope: dated + ongoing tasks only. Routine fields are present
// in the shared schemas (so the surface is stable), but the API's
// create/update endpoints reject `kind = 'routine'` until Slice 2 ships
// TaskInstance materialisation and the nightly job.

import { z } from 'zod';
import { TASK_KINDS, TASK_PRIORITIES } from './enums.js';

// ---------------------------------------------------------------------------
//  Section (Tasks.md §3.1)
// ---------------------------------------------------------------------------

/// Hex-colour validation — "#rgb" / "#rrggbb" case-insensitive.
const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'must be a hex color, e.g. #a1b2c3');

export const sectionResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  color: hexColorSchema,
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  /// Count of non-archived tasks pointing at this Section. Convenience
  /// for the UI; the client could derive it from `/v1/tasks` but every
  /// consumer needs it, so the server computes once.
  taskCount: z.number().int().nonnegative(),
});
export type SectionResponse = z.infer<typeof sectionResponseSchema>;

export const createSectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: hexColorSchema.optional(),
  /// Omit to append at the end.
  position: z.number().int().nonnegative().optional(),
});
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>;

export const updateSectionRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: hexColorSchema.optional(),
    position: z.number().int().nonnegative().optional(),
    /// Pass ISO-8601 to archive; pass `null` explicitly to unarchive.
    archivedAt: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'empty update' });
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>;

/// Delete semantics (Tasks.md §5.3): either move all tasks to Inbox (set
/// `sectionId=null`), or hard-delete every task in the section. Required
/// at the DELETE call site; no "do what I mean" default.
export const SECTION_DELETE_MODES = ['inbox', 'cascade'] as const;
export type SectionDeleteMode = (typeof SECTION_DELETE_MODES)[number];

// ---------------------------------------------------------------------------
//  Task (Tasks.md §3.2)
// ---------------------------------------------------------------------------

/// `YYYY-MM-DD` date-only (per PROJECT.md §7.1). Used for `startDate`,
/// `endDate`, and routine window endpoints. Enforced to parse as a real
/// calendar date (rejects `2026-02-30`, etc.).
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
    message: 'must be a valid calendar date',
  });

export const taskResponseSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().nullable(),
  kind: z.enum(TASK_KINDS),
  priority: z.enum(TASK_PRIORITIES),
  title: z.string(),
  description: z.string().nullable(),
  startDate: dateOnlySchema.nullable(),
  endDate: dateOnlySchema.nullable(),
  completedAt: z.string().datetime().nullable(),
  routineDaysOfWeek: z.array(z.number().int().min(1).max(7)),
  routineStartDate: dateOnlySchema.nullable(),
  routineEndDate: dateOnlySchema.nullable(),
  transferIfMissed: z.boolean(),
  transferredFromDate: dateOnlySchema.nullable(),
  inBacklog: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskResponse = z.infer<typeof taskResponseSchema>;

/// Per-kind body shapes (Tasks.md §3.2 "Per-kind rules").
///
/// Written as three discriminated-union branches rather than one bag of
/// optionals so TypeScript narrows correctly for the UI and the server
/// doesn't have to defensively re-validate kind consistency after Zod.
const datedCreateSchema = z.object({
  kind: z.literal('dated'),
  priority: z.enum(TASK_PRIORITIES),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
  sectionId: z.string().nullable().optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable().optional(),
  /// Only meaningful (and only accepted) on single-day dated tasks.
  /// Service enforces: rejects `true` when `endDate && endDate != startDate`.
  transferIfMissed: z.boolean().optional(),
});

const ongoingCreateSchema = z.object({
  kind: z.literal('ongoing'),
  priority: z.enum(TASK_PRIORITIES),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
  sectionId: z.string().nullable().optional(),
});

/// Routine creation. Days-of-week required and non-empty; the service
/// snapshots the current priority onto every materialised TaskInstance.
const routineCreateSchema = z.object({
  kind: z.literal('routine'),
  priority: z.enum(TASK_PRIORITIES),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
  sectionId: z.string().nullable().optional(),
  routineDaysOfWeek: z.array(z.number().int().min(1).max(7)).min(1),
  routineStartDate: dateOnlySchema.optional(),
  routineEndDate: dateOnlySchema.nullable().optional(),
});

export const createTaskRequestSchema = z
  .discriminatedUnion('kind', [
    datedCreateSchema,
    ongoingCreateSchema,
    routineCreateSchema,
  ])
  .superRefine((val, ctx) => {
    if (
      val.kind === 'dated' &&
      val.endDate !== undefined &&
      val.endDate !== null &&
      val.endDate < val.startDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be ≥ startDate',
      });
    }
  });
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/// PATCH body — any subset of the mutable fields. `kind` is immutable
/// after creation (Tasks.md §5.2) so it's absent here. `completedAt`
/// accepts a string to tick or explicit `null` to untick (Tasks.md §5.4).
export const updateTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10_000).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    sectionId: z.string().nullable().optional(),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.nullable().optional(),
    completedAt: z.union([z.string().datetime(), z.null()]).optional(),
    transferIfMissed: z.boolean().optional(),
    /// Routine subset — only accepted when the task's kind is 'routine';
    /// the service rejects these fields on dated/ongoing tasks.
    routineDaysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    routineStartDate: dateOnlySchema.optional(),
    routineEndDate: dateOnlySchema.nullable().optional(),
    archivedAt: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'empty update' });
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

/// GET /v1/tasks query filters. All optional.
export const listTasksQuerySchema = z.object({
  kind: z.enum(TASK_KINDS).optional(),
  sectionId: z.string().optional(),
  /// Include backlogged tasks in the response. Defaults false — the
  /// Dated / Ongoing panels never want them; Backlog panel sets true.
  backlog: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .optional(),
  /// Include archived tasks. Defaults false.
  archived: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

// ---------------------------------------------------------------------------
//  Error codes (uniform across sections + tasks)
// ---------------------------------------------------------------------------
export const TASK_ERROR_CODES = [
  'validation_failed',
  'section_not_found',
  'task_not_found',
  'instance_not_found',
  'kind_not_implemented',
  'kind_immutable',
  'transfer_requires_single_day',
  'section_delete_mode_required',
] as const;
export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
//  TaskInstance (Tasks.md §3.3)
// ---------------------------------------------------------------------------

/// One row per scheduled occurrence of a routine task. `priority` is a
/// snapshot of the parent's priority at materialisation time — editing
/// the parent later does not retroactively rewrite past instances.
export const taskInstanceResponseSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  scheduledDate: dateOnlySchema,
  priority: z.enum(TASK_PRIORITIES),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskInstanceResponse = z.infer<typeof taskInstanceResponseSchema>;

/// PATCH /v1/instances/:id — Slice 2 only toggles completion. Future
/// slices may add fields; keeping the body a single-key object keeps
/// the common case trivial.
export const updateInstanceRequestSchema = z
  .object({
    completedAt: z.union([z.string().datetime(), z.null()]),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'empty update' });
export type UpdateInstanceRequest = z.infer<typeof updateInstanceRequestSchema>;
