// Pure drain-loop orchestration for the telemetry flusher.
//
// This file has no browser API touches — everything I/O-shaped is
// behind the `FlushDeps` interface. That's what lets the self-check
// (`flusher.check.ts`) exercise the branch logic in plain Node with
// in-memory fakes.
//
// The concrete browser wiring (alarms + IndexedDB + fetch + storage)
// lives in `flusher.ts`, which imports these types and passes real
// implementations into `runDrain`.

import type { TelemetryEvent } from '@focus-tracker/shared';

/** Matches `telemetryBatchSchema.events.max(50)` in @focus-tracker/shared. */
export const BATCH_SIZE = 50;
/** Safety belt: even a wildly backlogged outbox won't spin forever in one tick. */
export const MAX_CHUNKS_PER_TICK = 20;

/**
 * Result of one `POST /v1/telemetry/batch` call. Kept flat so callers
 * can `switch (result.status)` without re-parsing HTTP status codes.
 * Mirrors the desktop client's `UploadError` (apps/desktop/src-tauri/
 * src/flusher.rs) for parity.
 */
export type UploadResult =
  | { status: 'ok'; response: { acceptedCount: number; duplicateCount: number } }
  | { status: 'transient'; message: string }
  | { status: 'auth_rejected'; message: string }
  | { status: 'permanent'; message: string };

export interface PairedIdentity {
  deviceId: string;
  apiKey: string;
}

export interface FlushDeps {
  getPaired: () => Promise<PairedIdentity | null>;
  getBatch: (limit: number) => Promise<TelemetryEvent[]>;
  removeMany: (ids: string[]) => Promise<void>;
  upload: (
    batch: { deviceId: string; events: TelemetryEvent[] },
    apiKey: string,
  ) => Promise<UploadResult>;
  onAuthRejected: () => Promise<void>;
  /** Any subset of Console we actually call — trivially satisfied by `console`. */
  log: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Overridable for tests. Defaults to `BATCH_SIZE` / `MAX_CHUNKS_PER_TICK`. */
  batchSize?: number;
  maxChunksPerTick?: number;
}

export interface FlushSummary {
  chunksSent: number;
  eventsAcked: number;
  eventsDropped: number;
  exitReason:
    | 'empty'
    | 'not_paired'
    | 'transient'
    | 'auth_rejected'
    | 'max_chunks'
    | 'paused';
}

/**
 * Drain the outbox in `batchSize` chunks. Returns after any of:
 *   * outbox is empty
 *   * we uploaded `maxChunksPerTick` chunks (bounded runtime per tick)
 *   * a transient failure — retry on the next alarm
 *   * an auth rejection — forget the device, stop
 */
export async function runDrain(deps: FlushDeps): Promise<FlushSummary> {
  const batchSize = deps.batchSize ?? BATCH_SIZE;
  const maxChunks = deps.maxChunksPerTick ?? MAX_CHUNKS_PER_TICK;

  const summary: FlushSummary = {
    chunksSent: 0,
    eventsAcked: 0,
    eventsDropped: 0,
    exitReason: 'empty',
  };

  const paired = await deps.getPaired();
  if (paired === null) {
    summary.exitReason = 'not_paired';
    return summary;
  }

  for (let chunk = 0; chunk < maxChunks; chunk++) {
    const events = await deps.getBatch(batchSize);
    if (events.length === 0) {
      summary.exitReason = 'empty';
      return summary;
    }
    const ackedIds = events.map((e) => e.id);

    const result = await deps.upload({ deviceId: paired.deviceId, events }, paired.apiKey);

    switch (result.status) {
      case 'ok': {
        await deps.removeMany(ackedIds);
        summary.chunksSent += 1;
        summary.eventsAcked += result.response.acceptedCount;
        deps.log.info(
          `[focus-tracker] flush ok — sent=${events.length} accepted=${result.response.acceptedCount} duplicates=${result.response.duplicateCount}`,
        );
        continue;
      }
      case 'transient': {
        deps.log.warn('[focus-tracker] flush transient, retry next tick:', result.message);
        summary.exitReason = 'transient';
        return summary;
      }
      case 'auth_rejected': {
        deps.log.error(
          '[focus-tracker] flush auth rejected — forgetting API key, user must re-pair:',
          result.message,
        );
        await deps.onAuthRejected();
        summary.exitReason = 'auth_rejected';
        return summary;
      }
      case 'permanent': {
        // Drop the batch: retrying the same bytes will fail identically.
        // Log loudly so a real bug (e.g. shape mismatch) is visible.
        // ponytail: v2 could move these to a dead-letter store instead of nuking.
        deps.log.error(
          `[focus-tracker] flush permanent reject — dropping ${events.length} event(s):`,
          result.message,
        );
        await deps.removeMany(ackedIds);
        summary.eventsDropped += events.length;
        continue;
      }
    }
  }

  summary.exitReason = 'max_chunks';
  return summary;
}
