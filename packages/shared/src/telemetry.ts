// Telemetry wire-protocol shapes shared by source clients and the API.
// Owner: PROJECT.md §12.4 / §12.5 + Sources Markdown/{Extension,DesktopApp}.md.
//
// Source clients hand-mirror these in their respective stacks: the browser
// extension imports them directly from this package; the desktop daemon
// re-declares the same shapes in Rust under apps/desktop/src-tauri/src/events.rs.

import { z } from 'zod';
import { DEVICE_SOURCES, TELEMETRY_EVENT_KINDS } from './enums.js';

/// Browser focus_change payload — what the user is currently looking at in a tab.
export const browserFocusTargetSchema = z.object({
  domain: z.string().min(1),
  url: z.string().url().optional(),
  title: z.string().optional(),
});
export type BrowserFocusTarget = z.infer<typeof browserFocusTargetSchema>;

/// Desktop focus_change payload — what app+window is currently in the foreground.
export const desktopFocusTargetSchema = z.object({
  appName: z.string().min(1),
  appBundleId: z.string().optional(),
  windowTitle: z.string().optional(),
});
export type DesktopFocusTarget = z.infer<typeof desktopFocusTargetSchema>;

/// One telemetry event as sent by a source client. `id` is generated CLIENT-SIDE
/// (ULID / UUIDv7) so retried batches are idempotent — see PROJECT.md §7.8.
export const telemetryEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(TELEMETRY_EVENT_KINDS),
  source: z.enum(DEVICE_SOURCES),
  /// Heterogeneous JSON. Shape depends on (kind, source). The API does shape
  /// checks per kind; this generic schema only guarantees it's an object.
  target: z.record(z.unknown()),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  clientVersion: z.string().min(1),
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/// Wire envelope for POST /v1/telemetry/batch.
/// Max 50 events per batch (server returns 413 above that — PROJECT.md §7.2).
export const telemetryBatchSchema = z.object({
  deviceId: z.string().uuid(),
  events: z.array(telemetryEventSchema).min(1).max(50),
});
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;

export const telemetryBatchResponseSchema = z.object({
  acceptedCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
});
export type TelemetryBatchResponse = z.infer<typeof telemetryBatchResponseSchema>;
