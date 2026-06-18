// Activity wire contracts shared by the API and the web app.
//
// Owner: Activity.md §6 (API surface), §3.2 (rollup table).
//
// Activity is the read-side view over the always-on telemetry stream the
// source clients ship into `ActivityMinuteRollup`. The two endpoints below
// drive both the `/activity` page and the dashboard "Today's activity"
// widget.

import { z } from 'zod';
import { DEVICE_SOURCES, TELEMETRY_EVENT_KINDS } from './enums.js';

// ---------------------------------------------------------------------------
//  Range selector + bucket grain
// ---------------------------------------------------------------------------

/// Range selector — fixed presets in v1 (Activity.md §4.1). Custom date
/// pickers are deferred. Order matters for the UI dropdown.
export const ACTIVITY_RANGES = ['today', 'yesterday', '7d', '30d'] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

/// Bucket grain used by the horizontal breakdown chart. The server picks
/// the grain from the range (hour for today/yesterday, day for 7d/30d).
export const ACTIVITY_BUCKET_GRAINS = ['hour', 'day'] as const;
export type ActivityBucketGrain = (typeof ACTIVITY_BUCKET_GRAINS)[number];

/// Top-N cap for app / site lists. The dashboard widget slices this down
/// to its own preference (top 3 per spec); the page surfaces all 5.
export const ACTIVITY_TOP_N = 5;

/// Hard cap for the recent-events feed payload. Anything above this is
/// clamped by the validator instead of erroring out.
export const ACTIVITY_RECENT_DEFAULT_LIMIT = 30;
export const ACTIVITY_RECENT_MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
//  GET /v1/activity/summary
// ---------------------------------------------------------------------------

/// Query params. `range` defaults to "today" when omitted so the dashboard
/// widget can hit the endpoint with no params.
export const activitySummaryQuerySchema = z.object({
  range: z.enum(ACTIVITY_RANGES).default('today'),
});
export type ActivitySummaryQuery = z.infer<typeof activitySummaryQuerySchema>;

/// One row of the top-N apps / top-N sites lists.
export const activityTargetTotalSchema = z.object({
  /// Display key — `appName` for desktop, `domain` for browser. Stable
  /// across an entire range; not URL-encoded or normalised further.
  target: z.string(),
  /// Sum of durationMs across the range for this target. Never negative.
  durationMs: z.number().int().nonnegative(),
});
export type ActivityTargetTotal = z.infer<typeof activityTargetTotalSchema>;

/// One bucket of the breakdown chart. Buckets are aligned in the user's
/// local timezone, then re-expressed as UTC instants on the wire.
///
/// For grain=hour: `bucketStart` is the start of an hour-in-user's-TZ.
/// For grain=day:  `bucketStart` is the start of a day-in-user's-TZ.
///
/// The two values split the total active time in the bucket by source so
/// the client can stack apps + sites in a single bar.
export const activityBucketSchema = z.object({
  bucketStart: z.string().datetime(),
  apps: z.number().int().nonnegative(),
  sites: z.number().int().nonnegative(),
});
export type ActivityBucket = z.infer<typeof activityBucketSchema>;

export const activitySummaryResponseSchema = z.object({
  range: z.object({
    label: z.enum(ACTIVITY_RANGES),
    /// Inclusive lower bound, UTC instant. Aligned to a TZ-local boundary.
    from: z.string().datetime(),
    /// Exclusive upper bound, UTC instant. For "today" / "7d" / "30d" this
    /// is the current instant (truncated to the second). For "yesterday"
    /// it's the start of today in the user's TZ.
    to: z.string().datetime(),
    bucketGrain: z.enum(ACTIVITY_BUCKET_GRAINS),
    /// IANA timezone the server used to compute boundaries (User.timezone).
    timezone: z.string(),
  }),
  totals: z.object({
    /// Sum of all source durations across the range, in ms.
    activeMs: z.number().int().nonnegative(),
    /// Sum of desktop-source durations only.
    apps: z.number().int().nonnegative(),
    /// Sum of browser-source durations only.
    sites: z.number().int().nonnegative(),
  }),
  topApps: z.array(activityTargetTotalSchema),
  topSites: z.array(activityTargetTotalSchema),
  buckets: z.array(activityBucketSchema),
});
export type ActivitySummaryResponse = z.infer<typeof activitySummaryResponseSchema>;

// ---------------------------------------------------------------------------
//  GET /v1/activity/recent
// ---------------------------------------------------------------------------

/// Query params. `z.coerce.number()` because query strings arrive as strings
/// from Express; we still validate the bounds.
export const activityRecentQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACTIVITY_RECENT_MAX_LIMIT)
    .default(ACTIVITY_RECENT_DEFAULT_LIMIT),
});
export type ActivityRecentQuery = z.infer<typeof activityRecentQuerySchema>;

/// One row of the "Recent switches" list. Mirrors `TelemetryEvent` but
/// flattened for direct UI rendering: `target` is the derived display
/// string (already extracted from the heterogeneous JSON shape), and the
/// device label is denormalised in so we don't need a per-event lookup.
export const activityRecentEventSchema = z.object({
  id: z.string(),
  source: z.enum(DEVICE_SOURCES),
  kind: z.enum(TELEMETRY_EVENT_KINDS),
  /// Derived display string — `appName` for desktop focus_change, `domain`
  /// for browser focus_change, `null` for non-focus events (heartbeats and
  /// session lifecycle).
  target: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /// User-editable device label (Device.label). `null` when the device
  /// row has been revoked since the event was ingested — the schema's
  /// `onDelete: SetNull` keeps the event but loses the attribution.
  deviceLabel: z.string().nullable(),
});
export type ActivityRecentEvent = z.infer<typeof activityRecentEventSchema>;

export const activityRecentResponseSchema = z.object({
  events: z.array(activityRecentEventSchema),
});
export type ActivityRecentResponse = z.infer<typeof activityRecentResponseSchema>;
