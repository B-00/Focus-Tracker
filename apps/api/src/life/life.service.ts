import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LifeGridResponse, LifeGridWeek } from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

// Memento Mori life-grid service.
//
// Owner: MementoMori.md §4.2 (base layer) + §6.1 / §6.2.
//
// Two things:
//   * refreshForUser()  — recomputes `week_activity_minutes` rows for a
//     single user from `activity_minute_rollup`. Single raw UPSERT.
//     Called from LifeScheduler (bootstrap + daily) and from the on-
//     read current-week refresh in getGrid().
//   * getGrid()         — returns the full LifeGridResponse for a user.
//
// MS_PER_WEEK = 7 * 24 * 3600 = 604_800 (seconds). Used inside the SQL
// to derive week-since-birthday from (timestamp - birthday) deltas.
//
// ponytail: weeks are indexed from (birthday at UTC midnight) in exact
// 7-day blocks. 52 weeks/year is approximate (the spec accepts the
// drift, §10). No tz juggling because the index is tz-agnostic — only
// "today" depends on the user's local clock, and that's computed in
// `getGrid()` from the current server UTC time + the stored birthday.
//
// The focus-session overlay from the initial Slice 2 was removed in
// Slice 2.1 per the user's call. We still write `hasSessions = false`
// into the (NOT NULL) column so the existing migration keeps working;
// downstream readers / later surfaces may revive the overlay by
// reintroducing the previous session_weeks CTE.

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;
const SEC_PER_WEEK = 7 * 24 * 3600;

/// How long a current-week row may linger before an incoming
/// `GET /v1/life/grid` triggers a background-friendly in-request
/// refresh. 10 minutes is plenty — telemetry rolls up every minute,
/// so the UI stays within one tick of "live" for anyone actively
/// looking at the page.
const CURRENT_WEEK_STALE_MS = 10 * 60 * 1000;

@Injectable()
export class LifeService {
  private readonly logger = new Logger(LifeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Read path — called by controller
  // ---------------------------------------------------------------------------

  async getGrid(userId: string): Promise<LifeGridResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthday: true, lifeExpectancyYears: true },
    });
    if (!user) throw new NotFoundException('user_not_found');

    // Spec §6.4: empty-state (no birthday) returns a response the client
    // uses to render the onboarding panel. We send a 200 with an empty
    // weeks array + `birthday: ''` sentinel rather than a 404; the client
    // already branches on `birthday === null` at the profile layer, and
    // this keeps the endpoint shape stable.
    if (!user.birthday) {
      return {
        birthday: '',
        lifeExpectancyYears: user.lifeExpectancyYears,
        currentWeekIndex: -1,
        weeks: [],
      };
    }

    const birthdayMs = user.birthday.getTime();
    const currentWeekIndex = Math.floor((Date.now() - birthdayMs) / MS_PER_WEEK);

    // On-read current-week refresh (spec §6.2 is silent about this but
    // without it the grid only moves once/day and users who open /life
    // today never see today's progress fill in). Non-blocking from the
    // client's perspective — we await it but the refresh is a single
    // upsert for one user and completes in <50ms on dev data.
    const needsRefresh = await this.isCurrentWeekStale(userId, currentWeekIndex);
    if (needsRefresh) {
      try {
        await this.refreshForUser(userId);
      } catch (err) {
        // Don't fail the read on a refresh error — stale data still
        // beats an error banner.
        this.logger.warn(
          `on-read refresh failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const rows = await this.prisma.weekActivityMinutes.findMany({
      where: { userId },
      orderBy: { weekIndex: 'asc' },
      select: { weekIndex: true, totalMinutes: true },
    });

    const weeks: LifeGridWeek[] = rows.map((r) => ({
      weekIndex: r.weekIndex,
      telemetryMinutes: r.totalMinutes,
    }));

    return {
      birthday: user.birthday.toISOString().slice(0, 10), // yyyy-mm-dd
      lifeExpectancyYears: user.lifeExpectancyYears,
      currentWeekIndex,
      weeks,
    };
  }

  // ---------------------------------------------------------------------------
  //  Refresh path — called by scheduler + on-read fallback
  // ---------------------------------------------------------------------------

  /// Upsert `week_activity_minutes` for one user. One row per week with
  /// any telemetry rollup data. Idempotent — re-running produces
  /// identical rows.
  ///
  /// Why raw SQL: the aggregation key is `FLOOR((minuteBucket - birthday) / 1 week)`,
  /// a computed expression Prisma can't group on. One statement is also
  /// cheaper than fetching ~2M rollup rows into Node.
  ///
  /// Nested CTE shape: Postgres can GROUP BY on a SELECT alias but not on
  /// a parameterised computed expression when the SELECT's textual form
  /// differs from the GROUP BY's — so we compute `week_index` once in
  /// `telemetry_rows` and aggregate on the alias in `telemetry_weeks`.
  async refreshForUser(userId: string): Promise<{ weeksWritten: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthday: true },
    });
    if (!user?.birthday) return { weeksWritten: 0 };

    const result = await this.prisma.$executeRaw(Prisma.sql`
      WITH wb AS (
        SELECT ${userId}::text AS user_id, ${user.birthday}::timestamp AS birthday
      ),
      telemetry_rows AS (
        SELECT
          wb.user_id,
          FLOOR(EXTRACT(EPOCH FROM (r."minuteBucket" - wb.birthday)) / ${SEC_PER_WEEK})::int AS week_index,
          r."durationMs" AS duration_ms
        FROM activity_minute_rollup r, wb
        WHERE r."userId" = wb.user_id
          AND r."minuteBucket" >= wb.birthday
      ),
      telemetry_weeks AS (
        SELECT
          user_id,
          week_index,
          (SUM(duration_ms) / 60000)::int AS total_minutes
        FROM telemetry_rows
        GROUP BY user_id, week_index
      )
      INSERT INTO week_activity_minutes ("userId", "weekIndex", "totalMinutes", "hasSessions", "computedAt")
      SELECT
        tw.user_id,
        tw.week_index,
        tw.total_minutes,
        FALSE,           -- session overlay removed; column stays for schema stability
        NOW()
      FROM telemetry_weeks tw
      ON CONFLICT ("userId", "weekIndex") DO UPDATE
        SET "totalMinutes" = EXCLUDED."totalMinutes",
            "hasSessions"  = EXCLUDED."hasSessions",
            "computedAt"   = NOW();
    `);

    return { weeksWritten: typeof result === 'number' ? result : 0 };
  }

  async refreshForAllUsers(): Promise<{ users: number; weeksWritten: number }> {
    const users = await this.prisma.user.findMany({
      where: { birthday: { not: null } },
      select: { id: true },
    });
    let total = 0;
    for (const u of users) {
      const { weeksWritten } = await this.refreshForUser(u.id);
      total += weeksWritten;
    }
    return { users: users.length, weeksWritten: total };
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

  /// Returns true when the row for `currentWeekIndex` is missing or
  /// older than `CURRENT_WEEK_STALE_MS`.
  private async isCurrentWeekStale(
    userId: string,
    currentWeekIndex: number,
  ): Promise<boolean> {
    if (currentWeekIndex < 0) return false; // birthday in the future
    const row = await this.prisma.weekActivityMinutes.findUnique({
      where: { userId_weekIndex: { userId, weekIndex: currentWeekIndex } },
      select: { computedAt: true },
    });
    if (!row) return true;
    return Date.now() - row.computedAt.getTime() > CURRENT_WEEK_STALE_MS;
  }
}
