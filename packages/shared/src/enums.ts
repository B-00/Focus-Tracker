// Enum mirrors of the Prisma schema (`apps/api/prisma/schema.prisma`).
//
// Declared as `as const` tuples + derived union types so consumers can:
//   * use the literal union as a type (`TaskPriority`)
//   * import the array (`TASK_PRIORITIES`) to drive validators, dropdowns, etc.
//
// If you add / remove an enum member here, update the Prisma schema in the
// same change — the two are intentionally in lockstep.

export const DEVICE_SOURCES = ['browser', 'desktop'] as const;
export type DeviceSource = (typeof DEVICE_SOURCES)[number];

export const TELEMETRY_EVENT_KINDS = [
  'focus_change',
  'heartbeat',
  'session_start',
  'session_end',
] as const;
export type TelemetryEventKind = (typeof TELEMETRY_EVENT_KINDS)[number];

export const TASK_KINDS = ['dated', 'ongoing', 'routine'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_PRIORITIES = ['low', 'mid', 'high', 'extreme'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/// Priority weights used by the chart base-score formula
/// (TaskCharts.md §5.1: `completedWeight / scheduledCount`, mid as reference).
export const TASK_PRIORITY_WEIGHT: Readonly<Record<TaskPriority, number>> = {
  low: 0.5,
  mid: 1.0,
  high: 1.5,
  extreme: 2.0,
};

export const FOCUS_SESSION_STATES = ['running', 'paused', 'completed', 'aborted'] as const;
export type FocusSessionState = (typeof FOCUS_SESSION_STATES)[number];

export const FOCUS_SESSION_MODES = ['timer', 'open'] as const;
export type FocusSessionMode = (typeof FOCUS_SESSION_MODES)[number];

export const FOCUS_SESSION_END_REASONS = ['timer_complete', 'manual_stop', 'aborted'] as const;
export type FocusSessionEndReason = (typeof FOCUS_SESSION_END_REASONS)[number];

export const API_KEY_SCOPES = ['telemetry_write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
