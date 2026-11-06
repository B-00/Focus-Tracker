// Focus-session wire contracts shared by API + web + (eventually) desktop/ext.
//
// Owner: Features Markdown/FocusSession.md
//   §3    — entity shape
//   §9    — endpoint behavior (incl. 409 concurrent-session payload)
//   §10   — API surface sketch
//
// Also owns tiny pure helpers for elapsed/effective duration math so client
// clocks, the server, and the summary view can't drift on pause arithmetic.

import { z } from 'zod';
import {
  FOCUS_SESSION_END_REASONS,
  FOCUS_SESSION_MODES,
  FOCUS_SESSION_STATES,
  type FocusSessionState,
} from './enums.js';

// ---------------------------------------------------------------------------
//  Error codes (PROJECT.md §7.5 error envelope)
// ---------------------------------------------------------------------------

export const FOCUS_SESSION_ERROR_CODES = [
  'session_already_active',   // POST /v1/focus-sessions while one is running/paused (§9.1)
  'session_not_found',        // :id lookup missed
  'invalid_state_transition', // e.g. pause on a completed session
  'planned_duration_required',// mode=timer with no plannedDurationMs
  'planned_duration_forbidden', // mode=open with a plannedDurationMs
] as const;
export type FocusSessionErrorCode = (typeof FOCUS_SESSION_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
//  Pause row
// ---------------------------------------------------------------------------

export const focusSessionPauseResponseSchema = z.object({
  id: z.string(),
  pausedAt: z.string(),            // ISO
  resumedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type FocusSessionPauseResponse = z.infer<
  typeof focusSessionPauseResponseSchema
>;

// ---------------------------------------------------------------------------
//  Session rows — current/detail vs list
// ---------------------------------------------------------------------------

/// Full shape returned by /current and /:id. `pauses` is sorted ASC by
/// `pausedAt`; the open pause (resumedAt=null) is always the last entry when
/// state === 'paused'.
export const focusSessionResponseSchema = z.object({
  id: z.string(),
  mode: z.enum(FOCUS_SESSION_MODES),
  state: z.enum(FOCUS_SESSION_STATES),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  plannedDurationMs: z.number().int().positive().nullable(),
  effectiveDurationMs: z.number().int().nonnegative().nullable(),
  endReason: z.enum(FOCUS_SESSION_END_REASONS).nullable(),
  taskId: z.string().nullable(),
  pauses: z.array(focusSessionPauseResponseSchema),
});
export type FocusSessionResponse = z.infer<typeof focusSessionResponseSchema>;

/// Compact shape for the history list — omits per-pause rows (just the
/// count + total) to keep page weight down when listing a month of sessions.
export const focusSessionListItemSchema = z.object({
  id: z.string(),
  mode: z.enum(FOCUS_SESSION_MODES),
  state: z.enum(FOCUS_SESSION_STATES),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  plannedDurationMs: z.number().int().positive().nullable(),
  effectiveDurationMs: z.number().int().nonnegative().nullable(),
  endReason: z.enum(FOCUS_SESSION_END_REASONS).nullable(),
  taskId: z.string().nullable(),
  pauseCount: z.number().int().nonnegative(),
  pauseTotalMs: z.number().int().nonnegative(),
});
export type FocusSessionListItem = z.infer<typeof focusSessionListItemSchema>;

export const focusSessionListResponseSchema = z.object({
  sessions: z.array(focusSessionListItemSchema),
});
export type FocusSessionListResponse = z.infer<
  typeof focusSessionListResponseSchema
>;

/// `GET /current` returns `null` when nothing's active (not a 404 — this is
/// the dashboard-widget hot path and nulls are cheaper than a thrown error
/// per 5s poll).
export const focusSessionCurrentResponseSchema = z.object({
  session: focusSessionResponseSchema.nullable(),
});
export type FocusSessionCurrentResponse = z.infer<
  typeof focusSessionCurrentResponseSchema
>;

// ---------------------------------------------------------------------------
//  Start / pause / resume / stop requests
// ---------------------------------------------------------------------------

/// `plannedDurationMs` is required when `mode === 'timer'` and forbidden
/// when `mode === 'open'`. Enforced via refinement so the error points at
/// the right field in the shared validation path.
export const startFocusSessionRequestSchema = z
  .object({
    mode: z.enum(FOCUS_SESSION_MODES),
    plannedDurationMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(), // ≤ 24h
    taskId: z.string().min(1).nullable().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === 'timer' && body.plannedDurationMs == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plannedDurationMs'],
        message: 'plannedDurationMs is required when mode is "timer"',
      });
    }
    if (body.mode === 'open' && body.plannedDurationMs != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plannedDurationMs'],
        message: 'plannedDurationMs must be omitted when mode is "open"',
      });
    }
  });
export type StartFocusSessionRequest = z.infer<
  typeof startFocusSessionRequestSchema
>;

/// 409 body returned by POST /v1/focus-sessions when one is already active.
/// Matches FocusSession.md §9.1.
export const sessionAlreadyActiveResponseSchema = z.object({
  error: z.literal('session_already_active'),
  existingSessionId: z.string(),
  existingSession: z.object({
    state: z.enum(FOCUS_SESSION_STATES),
    mode: z.enum(FOCUS_SESSION_MODES),
    startedAt: z.string(),
    plannedDurationMs: z.number().int().positive().nullable(),
    taskId: z.string().nullable(),
  }),
});
export type SessionAlreadyActiveResponse = z.infer<
  typeof sessionAlreadyActiveResponseSchema
>;

// ---------------------------------------------------------------------------
//  List query
// ---------------------------------------------------------------------------

const isoDateTime = z.string().datetime({ offset: true });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/// Either ISO timestamps (for precise windows) or YYYY-MM-DD (for day-bucketed
/// Calendar queries). Server resolves YYYY-MM-DD against the user's tz.
export const focusSessionListQuerySchema = z
  .object({
    from: z.union([isoDateTime, dateOnly]).optional(),
    to: z.union([isoDateTime, dateOnly]).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    { message: 'from must be <= to', path: ['from'] },
  );
export type FocusSessionListQuery = z.infer<typeof focusSessionListQuerySchema>;

// ---------------------------------------------------------------------------
//  Pure helpers — duration math (FocusSession.md §5)
// ---------------------------------------------------------------------------

/// Sum pause durations. Treats an open pause (`resumedAt: null`) as closing
/// at `asOf`, so an in-flight paused session's effective duration is sane
/// without the client having to do the special-case itself.
export function sumPauseMs(
  pauses: readonly { pausedAt: string; resumedAt: string | null }[],
  asOf: Date = new Date(),
): number {
  let total = 0;
  const asOfMs = asOf.getTime();
  for (const p of pauses) {
    const start = Date.parse(p.pausedAt);
    const end = p.resumedAt ? Date.parse(p.resumedAt) : asOfMs;
    if (end > start) total += end - start;
  }
  return total;
}

/// Wall-clock duration — includes paused intervals. For finished sessions
/// `endedAt` is present; for live ones falls back to `asOf`.
export function wallClockMs(
  session: Pick<FocusSessionResponse, 'startedAt' | 'endedAt'>,
  asOf: Date = new Date(),
): number {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : asOf.getTime();
  return Math.max(0, end - start);
}

/// Effective duration = wall-clock - total paused. For a running session
/// `effectiveDurationMs` is null on the server; the client derives it live
/// from this function. For a completed session the server's
/// `effectiveDurationMs` is authoritative — prefer it over this helper's
/// result to avoid clock skew.
export function effectiveMs(
  session: Pick<FocusSessionResponse, 'startedAt' | 'endedAt' | 'pauses'>,
  asOf: Date = new Date(),
): number {
  return Math.max(0, wallClockMs(session, asOf) - sumPauseMs(session.pauses, asOf));
}

/// Live state check — `true` while running or paused. Keeps the sticky-bar /
/// widget components from importing the enum just to compare strings.
export function isActiveState(state: FocusSessionState): boolean {
  return state === 'running' || state === 'paused';
}
