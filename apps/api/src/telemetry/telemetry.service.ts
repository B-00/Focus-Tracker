import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  TelemetryBatch,
  TelemetryBatchResponse,
  TelemetryEvent,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiKeyRequestContext } from '../auth/api-key-auth.guard';

/// Hard cap on `ActivityMinuteRollup.durationMs` per row. A row represents
/// "time spent on (user, source, target) during a single minute bucket",
/// so the maximum honest value is 60_000 ms. Multi-device users (e.g. a
/// dev workstation + a livestream rig) can otherwise have two devices
/// attributing time to the same `(user, source, target, minute)` slot,
/// pushing the per-row total past wall clock. We clamp at ingest so the
/// rollup never stores nonsense values that would later confuse the
/// Activity totals or per-minute aggregations.
const MINUTE_BUCKET_MAX_MS = 60_000;

/// Idempotent telemetry ingest (PROJECT.md §12.4 / §12.5 + Activity.md §3.2).
///
/// Wire contract:
///   POST /v1/telemetry/batch  (ApiKeyAuthGuard, scope=telemetry_write)
///   body: { deviceId, events: TelemetryEvent[1..50] }
///   200:  { acceptedCount, duplicateCount }
///   401:  token issues (handled by the guard)
///   403:  body.deviceId !== api-key's bound deviceId    → device_mismatch
///   413:  >50 events                                    → (validation_failed via Zod)
///
/// Pipeline per batch:
///   1. Verify the body's deviceId matches the API key's bound deviceId
///   2. Dedup: SELECT existing event ids in one query
///   3. For new events, look up active focus session + its pauses ONCE
///      and attribute focusSessionId per-event (null if no active session)
///   4. Bulk createMany (skipDuplicates as a defence-in-depth net)
///   5. For each new focus_change event: upsert ActivityMinuteRollup per
///      minute the event's duration spans (proper splitting)
///   6. Bump Device.lastSeen + Device.lastSuccessfulIngestAt
///   7. Return { acceptedCount, duplicateCount }
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    client: ApiKeyRequestContext,
    batch: TelemetryBatch,
  ): Promise<TelemetryBatchResponse> {
    // -------------------------------------------------------------------
    //  1. Device check (defence in depth — the API key is already
    //     bound to a device; a mismatching deviceId in the body would
    //     indicate a client bug or a stolen key in the wrong hands).
    // -------------------------------------------------------------------
    if (batch.deviceId !== client.deviceId) {
      throw new ForbiddenException({
        error: 'device_mismatch',
        hint: 'Batch deviceId does not match the API key\'s bound device.',
      });
    }

    // Reject events whose `source` doesn't match the API-key's device. The
    // source's row in the DB has a fixed `source` column; sending a browser
    // event from a desktop key (or vice versa) is a protocol violation.
    const device = await this.prisma.device.findUnique({
      where: { id: client.deviceId },
      select: { source: true },
    });
    if (!device) {
      // Race: device was revoked between the guard's lookup and now. Treat
      // as invalid auth.
      throw new ForbiddenException({ error: 'api_key_revoked' });
    }
    const wrongSource = batch.events.find((e) => e.source !== device.source);
    if (wrongSource) {
      throw new BadRequestException({
        error: 'event_source_mismatch',
        hint: `Event ${wrongSource.id} has source="${wrongSource.source}" but the device is "${device.source}".`,
      });
    }

    // -------------------------------------------------------------------
    //  2. Dedup
    // -------------------------------------------------------------------
    const incomingIds = batch.events.map((e) => e.id);
    const existing = await this.prisma.telemetryEvent.findMany({
      where: { id: { in: incomingIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));
    const newEvents = batch.events.filter((e) => !existingIds.has(e.id));

    if (newEvents.length === 0) {
      await this.bumpDeviceTimestamps(client.deviceId);
      return {
        acceptedCount: 0,
        duplicateCount: existingIds.size,
      };
    }

    // -------------------------------------------------------------------
    //  3. Focus-session attribution (returns a per-event id-or-null map)
    // -------------------------------------------------------------------
    const attributionByEventId = await this.attributeFocusSessions(
      client.userId,
      newEvents,
    );

    // -------------------------------------------------------------------
    //  4 + 5 + 6. Persist in one transaction so a partial write doesn't
    //  desync the rollup. The transaction is small (≤50 events + ~50
    //  rollup upserts + 1 device update) — interactive timeout is fine.
    // -------------------------------------------------------------------
    await this.prisma.$transaction(async (tx) => {
      // 4. Insert raw events
      await tx.telemetryEvent.createMany({
        data: newEvents.map((e) => ({
          id: e.id,
          userId: client.userId,
          deviceId: client.deviceId,
          source: e.source,
          kind: e.kind,
          target: e.target as unknown as Prisma.InputJsonValue,
          startedAt: new Date(e.startedAt),
          endedAt: e.endedAt ? new Date(e.endedAt) : null,
          durationMs: e.durationMs ?? null,
          focusSessionId: attributionByEventId.get(e.id) ?? null,
          clientVersion: e.clientVersion,
        })),
        // Belt-and-suspenders: a second client racing with the same event
        // id could slip past the SELECT above. The createMany skipDuplicates
        // means we count those as 0 inserts; the rollup loop below skips
        // them too because we filtered above. Combined effect: at-most-once
        // delivery semantics across racing clients.
        skipDuplicates: true,
      });

      // 5. Activity rollup — only focus_change events feed it (Activity.md §3).
      //    Each row is hard-capped at MINUTE_BUCKET_MAX_MS so two devices
      //    attributing time to the same (user, source, target, minute) slot
      //    can't push the per-row total past 60s wall clock. We read the
      //    existing row inside the same transaction to compute the remaining
      //    budget, then upsert with the clamped increment. Read-modify-write
      //    pairs are safe here because the surrounding $transaction holds the
      //    same Postgres connection serially.
      for (const event of newEvents) {
        if (event.kind !== 'focus_change') continue;
        const buckets = this.splitAcrossMinutes(event);
        const rollupTarget = this.deriveRollupTarget(event);
        if (rollupTarget === null) continue;
        for (const bucket of buckets) {
          if (bucket.durationMs <= 0) continue;
          const slotKey = {
            userId_source_target_minuteBucket: {
              userId: client.userId,
              source: event.source,
              target: rollupTarget,
              minuteBucket: bucket.minuteBucket,
            },
          };
          const existing = await tx.activityMinuteRollup.findUnique({
            where: slotKey,
            select: { durationMs: true },
          });
          const currentMs = existing?.durationMs ?? 0;
          const budgetMs = MINUTE_BUCKET_MAX_MS - currentMs;
          if (budgetMs <= 0) continue; // slot already at cap
          const addMs = Math.min(bucket.durationMs, budgetMs);
          if (existing) {
            await tx.activityMinuteRollup.update({
              where: slotKey,
              data: { durationMs: { increment: addMs } },
            });
          } else {
            await tx.activityMinuteRollup.create({
              data: {
                userId: client.userId,
                source: event.source,
                target: rollupTarget,
                minuteBucket: bucket.minuteBucket,
                durationMs: addMs,
              },
            });
          }
        }
      }

      // 6. Per-device freshness markers
      await tx.device.update({
        where: { id: client.deviceId },
        data: {
          lastSeen: new Date(),
          lastSuccessfulIngestAt: new Date(),
        },
      });
    });

    return {
      acceptedCount: newEvents.length,
      duplicateCount: existingIds.size,
    };
  }

  // -----------------------------------------------------------------------
  //  Helpers
  // -----------------------------------------------------------------------

  /// Look up the currently-active focus session for the user ONCE per
  /// batch, then for each event decide whether `event.startedAt` falls
  /// inside the session AND outside every pause sub-window (FocusSession.md
  /// §5.2). Returns a Map<eventId, focusSessionId | null>.
  ///
  /// Known v1 limitation: only attributes against the user's currently
  /// `running` / `paused` session. Late-arriving events whose `startedAt`
  /// fell inside an already-`completed` session are recorded with
  /// `focusSessionId = null`. Acceptable trade-off — FocusSession isn't
  /// built yet, so this code is effectively dormant; we revisit when the
  /// session UI lands.
  private async attributeFocusSessions(
    userId: string,
    events: TelemetryEvent[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();

    const active = await this.prisma.focusSession.findFirst({
      where: { userId, state: { in: ['running', 'paused'] } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        pauses: {
          select: { pausedAt: true, resumedAt: true },
          orderBy: { pausedAt: 'asc' },
        },
      },
    });

    if (!active) {
      for (const e of events) result.set(e.id, null);
      return result;
    }

    for (const e of events) {
      const eventStart = new Date(e.startedAt);
      const inWindow =
        active.startedAt <= eventStart &&
        (active.endedAt === null || active.endedAt > eventStart);
      if (!inWindow) {
        result.set(e.id, null);
        continue;
      }
      const inAnyPause = active.pauses.some(
        (p) => p.pausedAt <= eventStart && (p.resumedAt === null || p.resumedAt > eventStart),
      );
      result.set(e.id, inAnyPause ? null : active.id);
    }
    return result;
  }

  /// Derives the stable, display-ready rollup key from an event's `target`
  /// JSON. Returns null for events that don't contribute to activity
  /// (heartbeats, session lifecycle events, anything malformed).
  ///
  /// See schema.prisma `ActivityMinuteRollup.target` for the spec.
  private deriveRollupTarget(event: TelemetryEvent): string | null {
    if (event.kind !== 'focus_change') return null;
    const target = event.target as Record<string, unknown>;
    if (event.source === 'browser') {
      const domain = target.domain;
      return typeof domain === 'string' && domain.length > 0 ? domain : null;
    }
    // desktop
    const appName = target.appName;
    return typeof appName === 'string' && appName.length > 0 ? appName : null;
  }

  /// Splits an event's duration across the minute buckets it spans, so a
  /// focus that lasted from 10:00:30 → 10:02:15 contributes 30s to 10:00,
  /// 60s to 10:01, and 15s to 10:02. Returns at least one bucket (the
  /// startedAt minute) even for zero-duration events.
  private splitAcrossMinutes(
    event: TelemetryEvent,
  ): Array<{ minuteBucket: Date; durationMs: number }> {
    const startedAt = new Date(event.startedAt).getTime();
    const durationMs = this.resolveDuration(event);

    if (durationMs <= 0) {
      return [{ minuteBucket: this.truncateToMinute(startedAt), durationMs: 0 }];
    }

    const buckets: Array<{ minuteBucket: Date; durationMs: number }> = [];
    let cursor = startedAt;
    let remaining = durationMs;
    while (remaining > 0) {
      const bucketStartMs = Math.floor(cursor / 60_000) * 60_000;
      const bucketEndMs = bucketStartMs + 60_000;
      const msInBucket = Math.min(remaining, bucketEndMs - cursor);
      buckets.push({
        minuteBucket: new Date(bucketStartMs),
        durationMs: msInBucket,
      });
      cursor = bucketEndMs;
      remaining -= msInBucket;
    }
    return buckets;
  }

  private resolveDuration(event: TelemetryEvent): number {
    if (typeof event.durationMs === 'number') return event.durationMs;
    if (event.endedAt) {
      const ms = new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime();
      return Math.max(ms, 0);
    }
    return 0;
  }

  private truncateToMinute(ms: number): Date {
    return new Date(Math.floor(ms / 60_000) * 60_000);
  }

  /// Used when a batch is 100% duplicates — we still want to record that
  /// the device successfully checked in, even if no rows were written.
  private async bumpDeviceTimestamps(deviceId: string): Promise<void> {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { lastSeen: new Date(), lastSuccessfulIngestAt: new Date() },
    });
  }
}
