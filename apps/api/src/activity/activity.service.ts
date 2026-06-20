import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActivityBucket,
  ActivityBucketGrain,
  ActivityRange,
  ActivityRecentEvent,
  ActivityRecentResponse,
  ActivitySummaryResponse,
  ActivityTargetTotal,
} from '@focus-tracker/shared';
import { ACTIVITY_TOP_N } from '@focus-tracker/shared';
import type { DeviceSource, Prisma, TelemetryEventKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addBucketsInTz, startOfBucketInTz } from './tz.util';

/// Read-side aggregations over `ActivityMinuteRollup` and `TelemetryEvent`
/// for the `/activity` page and the dashboard "Today's activity" widget.
///
/// Owner: Activity.md §5 (data fetching) + §6 (API surface).
///
/// Performance shape:
///   * `summary` reads `ActivityMinuteRollup` filtered to `[from, to)` and
///     aggregates in memory. For the worst v1 range ("30d" = 30 days * ~50
///     unique targets per day * up to ~12 distinct minute-rows per target
///     per day = ~18k rows) this is comfortably under one Postgres trip.
///   * `recent` is a straight `LIMIT N ORDER BY startedAt DESC` over the
///     raw event table, joined to Device for the label.
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  //  GET /v1/activity/summary?range=...
  // -------------------------------------------------------------------------

  async summary(
    userId: string,
    range: ActivityRange,
  ): Promise<ActivitySummaryResponse> {
    const tz = await this.resolveTimezone(userId);
    const now = new Date();
    const { from, to, bucketGrain } = this.resolveRange(range, tz, now);

    const rows = await this.prisma.activityMinuteRollup.findMany({
      where: {
        userId,
        minuteBucket: { gte: from, lt: to },
      },
      select: {
        source: true,
        target: true,
        minuteBucket: true,
        durationMs: true,
      },
    });

    // Totals + per-target sums + per-(bucket, source, target) sums in one
    // pass. The per-bucket per-target map drives the stacked chart's
    // segments — the chart shows each top-N target's contribution to each
    // bucket so the user can see "Cursor in hour 14, Firefox in hour 15".
    let totalApps = 0;
    let totalSites = 0;
    const targetTotals = new Map<DeviceSource, Map<string, number>>();
    const bucketKeys: number[] = this.generateBucketKeys(from, to, bucketGrain, tz);
    const buckets = new Map<number, { apps: number; sites: number }>();
    for (const key of bucketKeys) buckets.set(key, { apps: 0, sites: 0 });
    /// bucketKey → source → target → durationMs in that bucket.
    /// Populated alongside the simpler totals so we don't take a second
    /// pass over the rollup rows.
    const perTargetByBucket = new Map<
      number,
      Map<DeviceSource, Map<string, number>>
    >();

    for (const row of rows) {
      if (row.source === 'desktop') totalApps += row.durationMs;
      else totalSites += row.durationMs;

      const bySource = targetTotals.get(row.source) ?? new Map<string, number>();
      bySource.set(row.target, (bySource.get(row.target) ?? 0) + row.durationMs);
      targetTotals.set(row.source, bySource);

      const bucketStart = startOfBucketInTz(row.minuteBucket, tz, bucketGrain);
      const bucketKey = bucketStart.getTime();
      const b = buckets.get(bucketKey);
      // A row falling outside the generated bucket range can happen on a
      // DST spring-forward edge where the loop boundary math doesn't quite
      // line up with the rollup row's bucket. Drop silently — the totals
      // are still correct since they're computed independently.
      if (!b) continue;
      if (row.source === 'desktop') b.apps += row.durationMs;
      else b.sites += row.durationMs;

      // Per-target breakdown for the stacked chart.
      let bucketTargets = perTargetByBucket.get(bucketKey);
      if (!bucketTargets) {
        bucketTargets = new Map();
        perTargetByBucket.set(bucketKey, bucketTargets);
      }
      let sourceTargets = bucketTargets.get(row.source);
      if (!sourceTargets) {
        sourceTargets = new Map();
        bucketTargets.set(row.source, sourceTargets);
      }
      sourceTargets.set(
        row.target,
        (sourceTargets.get(row.target) ?? 0) + row.durationMs,
      );
    }

    const topApps = this.topN(targetTotals.get('desktop'));
    const topSites = this.topN(targetTotals.get('browser'));

    return {
      range: {
        label: range,
        from: from.toISOString(),
        to: to.toISOString(),
        bucketGrain,
        timezone: tz,
      },
      totals: {
        activeMs: totalApps + totalSites,
        apps: totalApps,
        sites: totalSites,
      },
      topApps,
      topSites,
      buckets: bucketKeys.map((key) => {
        const b = buckets.get(key)!;
        const sources = perTargetByBucket.get(key);
        const appsTargets = sources?.get('desktop');
        const sitesTargets = sources?.get('browser');
        return {
          bucketStart: new Date(key).toISOString(),
          apps: b.apps,
          sites: b.sites,
          // Align with topApps / topSites order. Missing targets => 0
          // (the target wasn't active in this bucket). The chart computes
          // "Other" share as `apps - sum(appsByTopTarget)`.
          appsByTopTarget: topApps.map(
            (t) => appsTargets?.get(t.target) ?? 0,
          ),
          sitesByTopTarget: topSites.map(
            (t) => sitesTargets?.get(t.target) ?? 0,
          ),
        };
      }) satisfies ActivityBucket[],
    };
  }

  // -------------------------------------------------------------------------
  //  GET /v1/activity/recent?limit=...
  // -------------------------------------------------------------------------

  async recent(userId: string, limit: number): Promise<ActivityRecentResponse> {
    const events = await this.prisma.telemetryEvent.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        source: true,
        kind: true,
        target: true,
        startedAt: true,
        endedAt: true,
        durationMs: true,
        device: { select: { label: true } },
      },
    });

    return {
      events: events.map((e) => this.flattenEvent(e)) satisfies ActivityRecentEvent[],
    };
  }

  // -------------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------------

  /// Returns the user's IANA timezone, defaulting to UTC. NotFound on a
  /// missing user — the JWT guard would normally catch this, but a soft
  /// guard here means we never crash on a stale token.
  private async resolveTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!user) throw new NotFoundException({ error: 'user_not_found' });
    return user.timezone || 'UTC';
  }

  /// Maps a `range` enum value to its `[from, to)` UTC window + bucket
  /// grain, all in the user's timezone.
  private resolveRange(
    range: ActivityRange,
    tz: string,
    now: Date,
  ): { from: Date; to: Date; bucketGrain: ActivityBucketGrain } {
    const todayStart = startOfBucketInTz(now, tz, 'day');
    switch (range) {
      case 'today':
        return { from: todayStart, to: now, bucketGrain: 'hour' };
      case 'yesterday': {
        const yesterdayStart = addBucketsInTz(todayStart, -1, tz, 'day');
        return { from: yesterdayStart, to: todayStart, bucketGrain: 'hour' };
      }
      case '7d': {
        const from = addBucketsInTz(todayStart, -6, tz, 'day');
        return { from, to: now, bucketGrain: 'day' };
      }
      case '30d': {
        const from = addBucketsInTz(todayStart, -29, tz, 'day');
        return { from, to: now, bucketGrain: 'day' };
      }
    }
  }

  /// Walks the [from, to) window in bucket-sized steps and returns the
  /// list of bucket UTC start instants as numeric keys (ms-since-epoch).
  /// Always includes the bucket containing `from`; never includes a
  /// bucket whose start is >= `to`.
  private generateBucketKeys(
    from: Date,
    to: Date,
    grain: ActivityBucketGrain,
    tz: string,
  ): number[] {
    const keys: number[] = [];
    let cursor = startOfBucketInTz(from, tz, grain);
    let safety = 0;
    while (cursor.getTime() < to.getTime()) {
      keys.push(cursor.getTime());
      cursor = addBucketsInTz(cursor, 1, tz, grain);
      // Defence-in-depth: 30 days * 24 hours = 720 hour-buckets worst
      // case. Anything above 1000 means we're stuck in a DST math loop.
      if (++safety > 1000) {
        throw new Error('generateBucketKeys: safety limit exceeded');
      }
    }
    return keys;
  }

  /// Top-N entries from a `target → durationMs` map, sorted descending.
  /// Tie-breaks by target name (alphabetical, ascending) so the order is
  /// stable across polls.
  private topN(
    map: Map<string, number> | undefined,
  ): ActivityTargetTotal[] {
    if (!map) return [];
    const entries = [...map.entries()];
    entries.sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    return entries
      .slice(0, ACTIVITY_TOP_N)
      .map(([target, durationMs]) => ({ target, durationMs }));
  }

  /// Flattens a raw `TelemetryEvent` Prisma row to the wire shape. The
  /// `target` JSON column gets decoded to its display string here so the
  /// client doesn't have to know the per-source key (`appName` vs
  /// `domain`). Mirrors the logic in `TelemetryService.deriveRollupTarget`.
  private flattenEvent(
    e: {
      id: string;
      source: DeviceSource;
      kind: TelemetryEventKind;
      target: Prisma.JsonValue;
      startedAt: Date;
      endedAt: Date | null;
      durationMs: number | null;
      device: { label: string } | null;
    },
  ): ActivityRecentEvent {
    return {
      id: e.id,
      source: e.source,
      kind: e.kind,
      target: this.extractTargetDisplay(e.target, e.kind, e.source),
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString() ?? null,
      durationMs: e.durationMs,
      deviceLabel: e.device?.label ?? null,
    };
  }

  private extractTargetDisplay(
    target: Prisma.JsonValue,
    kind: TelemetryEventKind,
    source: DeviceSource,
  ): string | null {
    if (kind !== 'focus_change') return null;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return null;
    }
    const obj = target as Record<string, unknown>;
    if (source === 'desktop') {
      const appName = obj.appName;
      return typeof appName === 'string' && appName.length > 0 ? appName : null;
    }
    const domain = obj.domain;
    return typeof domain === 'string' && domain.length > 0 ? domain : null;
  }
}
