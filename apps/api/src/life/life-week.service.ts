import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LifeWeekDetail,
  LifeWeekNote,
  LifeWeekTopItem,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

// Per-week drilldown service for the life calendar.
//
// Owner: MementoMori.md §5.1 (past-week drawer) + §5.2 (current-week
// read-only variant) + §6.1 / §7.
//
// Reads:
//   * getWeek(userId, weekIndex) — composite read: date range, telemetry
//     mins, session count + total effective ms, top-3 apps / top-3 sites,
//     tasks completed in range, and the existing WeekNote.
//
// Writes:
//   * upsertNote(userId, weekIndex, body) — only for past weeks (spec
//     §3.5 / §5.2). Empty body deletes the row so "cleared" and "never
//     written" collapse to the same state.
//
// ponytail: all queries are scoped by (userId, weekIndex → window).
// Window math uses UTC midnight 7-day blocks to match the grid's week
// numbering (see life-math.ts selfCheck).

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;
const TOP_N = 3;

@Injectable()
export class LifeWeekService {
  constructor(private readonly prisma: PrismaService) {}

  async getWeek(userId: string, weekIndex: number): Promise<LifeWeekDetail> {
    if (!Number.isInteger(weekIndex) || weekIndex < 0) {
      throw new BadRequestException('invalid_week_index');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthday: true },
    });
    if (!user) throw new NotFoundException('user_not_found');
    if (!user.birthday) throw new BadRequestException('birthday_not_set');

    const { start, end, currentWeekIndex } = computeWindow(user.birthday, weekIndex);
    const isCurrent = weekIndex === currentWeekIndex;
    const isPast = weekIndex < currentWeekIndex;

    // Parallel fan-out: these five reads touch different tables and don't
    // depend on each other, so a Promise.all keeps the detail endpoint
    // under the 100ms-ish budget even on cold caches.
    const [rollupAgg, sessionsAgg, topApps, topSites, tasksCompleted, note] =
      await Promise.all([
        this.prisma.activityMinuteRollup.aggregate({
          where: { userId, minuteBucket: { gte: start, lt: end } },
          _sum: { durationMs: true },
        }),
        this.prisma.focusSession.aggregate({
          where: {
            userId,
            state: 'completed',
            endedAt: { gte: start, lt: end },
          },
          _count: { _all: true },
          _sum: { effectiveDurationMs: true },
        }),
        this.topTargets(userId, start, end, 'desktop'),
        this.topTargets(userId, start, end, 'browser'),
        this.countTasksCompleted(userId, start, end),
        this.prisma.weekNote.findUnique({
          where: { userId_weekIndex: { userId, weekIndex } },
          select: { body: true, updatedAt: true },
        }),
      ]);

    const telemetryMinutes = Math.floor(
      (rollupAgg._sum.durationMs ?? 0) / 60_000,
    );

    const noteShape: LifeWeekNote | null = note
      ? { body: note.body, updatedAt: note.updatedAt.toISOString() }
      : null;

    return {
      weekIndex,
      startDate: ymd(start),
      endDate: ymd(new Date(end.getTime() - 86_400_000)), // inclusive last day
      isPast,
      isCurrent,
      telemetryMinutes,
      sessions: {
        count: sessionsAgg._count._all,
        totalEffectiveMs: sessionsAgg._sum.effectiveDurationMs ?? 0,
      },
      topApps,
      topSites,
      tasksCompleted,
      note: noteShape,
    };
  }

  async upsertNote(
    userId: string,
    weekIndex: number,
    body: string,
  ): Promise<LifeWeekNote | null> {
    if (!Number.isInteger(weekIndex) || weekIndex < 0) {
      throw new BadRequestException('invalid_week_index');
    }
    if (body.length > 2000) {
      throw new BadRequestException('body_too_long');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthday: true },
    });
    if (!user) throw new NotFoundException('user_not_found');
    if (!user.birthday) throw new BadRequestException('birthday_not_set');

    const { currentWeekIndex } = computeWindow(user.birthday, weekIndex);

    // Spec §3.5 / §5.2: notes are only writable for past weeks. The
    // current week flips to writable the instant it rolls over, so a
    // single `< currentWeekIndex` check is enough.
    if (weekIndex >= currentWeekIndex) {
      throw new ForbiddenException('week_not_past');
    }

    // Empty body collapses "never written" and "cleared" into one state
    // — deleting the row is the simplest way to express that.
    if (body.length === 0) {
      await this.prisma.weekNote.deleteMany({
        where: { userId, weekIndex },
      });
      return null;
    }

    const row = await this.prisma.weekNote.upsert({
      where: { userId_weekIndex: { userId, weekIndex } },
      create: { userId, weekIndex, body },
      update: { body },
      select: { body: true, updatedAt: true },
    });

    return { body: row.body, updatedAt: row.updatedAt.toISOString() };
  }

  /// Top-N targets by durationMs within a week window, filtered by
  /// source. `target` is a flat string on activity_minute_rollup — the
  /// domain for browser, the appName for desktop — so a straight
  /// GROUP BY beats the JSON path extraction on the raw event table.
  private async topTargets(
    userId: string,
    start: Date,
    end: Date,
    source: 'browser' | 'desktop',
  ): Promise<LifeWeekTopItem[]> {
    const rows = await this.prisma.$queryRaw<
      { target: string; duration_ms: bigint }[]
    >(Prisma.sql`
      SELECT target, SUM("durationMs")::bigint AS duration_ms
      FROM activity_minute_rollup
      WHERE "userId" = ${userId}
        AND source = ${source}::"DeviceSource"
        AND "minuteBucket" >= ${start}
        AND "minuteBucket" <  ${end}
      GROUP BY target
      ORDER BY duration_ms DESC
      LIMIT ${TOP_N}
    `);
    return rows.map((r) => ({
      name: r.target,
      durationMs: Number(r.duration_ms),
    }));
  }

  /// Task + TaskInstance completedAt in range. One-shots count as Task;
  /// routines count via TaskInstance (per Tasks.md routine model).
  private async countTasksCompleted(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const [tasks, instances] = await Promise.all([
      this.prisma.task.count({
        where: { userId, completedAt: { gte: start, lt: end } },
      }),
      this.prisma.taskInstance.count({
        where: {
          task: { userId },
          completedAt: { gte: start, lt: end },
        },
      }),
    ]);
    return tasks + instances;
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/// Resolve a weekIndex to its [start, end) UTC-midnight window and the
/// user's live currentWeekIndex. Mirrors the frontend's life-math
/// `weekRange` so client and server agree on the bucketing.
function computeWindow(
  birthday: Date,
  weekIndex: number,
): { start: Date; end: Date; currentWeekIndex: number } {
  // Normalise the stored birthday to UTC midnight. Prisma returns a
  // Date whose epoch is already midnight because the column is @db.Date,
  // but we rebuild it from Y/M/D to be defensive against driver quirks.
  const b = new Date(
    Date.UTC(
      birthday.getUTCFullYear(),
      birthday.getUTCMonth(),
      birthday.getUTCDate(),
    ),
  );
  const start = new Date(b.getTime() + weekIndex * MS_PER_WEEK);
  const end = new Date(start.getTime() + MS_PER_WEEK);
  const currentWeekIndex = Math.floor((Date.now() - b.getTime()) / MS_PER_WEEK);
  return { start, end, currentWeekIndex };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
