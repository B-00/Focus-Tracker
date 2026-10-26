import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  TaskInstance as PrismaTaskInstance,
  Prisma,
} from '@prisma/client';
import type {
  TaskInstanceResponse,
  UpdateInstanceRequest,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import { wallClockInTz } from '../activity/tz.util';

/// TaskInstance surface for routine tasks. Slice 2 scope:
///   * `listToday(userId)` — lazy-materialises today's instance for
///      every routine that's scheduled today and in-window, then
///      returns every instance anchored at today's date.
///   * `update(userId, id, body)` — toggle completion (set / clear
///      `completedAt`) on an owned instance.
///
/// Past-day materialisation (Tasks.md §5.5 Step 1) is deferred to the
/// nightly job slice — the chart that consumes historical misses lands
/// in Slice 5, so there's nothing in the UI yet that would notice.
///
/// Timezone: "today" is resolved in the user's local TZ (User.timezone,
/// IANA). A user in UTC-5 opening /tasks at 11pm local still sees "today"
/// as their local calendar day, not the UTC day. Reuses the tz helpers
/// built for Activity to stay dependency-free.
@Injectable()
export class InstancesService {
  constructor(private readonly prisma: PrismaService) {}

  async listToday(userId: string): Promise<TaskInstanceResponse[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone ?? 'UTC';
    const wc = wallClockInTz(new Date(), tz);
    const todayYmd = `${pad4(wc.year)}-${pad2(wc.month)}-${pad2(wc.day)}`;
    const todayDbDate = toDbDate(todayYmd);
    const isoWeekday = isoWeekdayOf(wc.year, wc.month, wc.day);

    // Candidate routines: owned, non-archived, today's weekday listed,
    // today ∈ [routineStartDate, routineEndDate] (either bound can be
    // null = open-ended).
    const routines = await this.prisma.task.findMany({
      where: {
        userId,
        kind: 'routine',
        archivedAt: null,
        routineDaysOfWeek: { has: isoWeekday },
        AND: [
          {
            OR: [
              { routineStartDate: null },
              { routineStartDate: { lte: todayDbDate } },
            ],
          },
          {
            OR: [
              { routineEndDate: null },
              { routineEndDate: { gte: todayDbDate } },
            ],
          },
        ],
      },
      select: { id: true, priority: true },
    });

    if (routines.length > 0) {
      // Snapshot the parent's priority onto the instance at
      // materialisation time (Tasks.md §3.3). The unique(taskId,
      // scheduledDate) index + skipDuplicates makes this idempotent
      // and safe to call on every request.
      await this.prisma.taskInstance.createMany({
        data: routines.map((r) => ({
          taskId: r.id,
          scheduledDate: todayDbDate,
          priority: r.priority,
        })),
        skipDuplicates: true,
      });
    }

    // Return today's instances scoped to this user's routines. Join
    // via `task.userId` so we don't accidentally hand back someone
    // else's rows if a bad id ever leaks into state.
    const instances = await this.prisma.taskInstance.findMany({
      where: {
        scheduledDate: todayDbDate,
        task: { userId },
      },
      orderBy: { createdAt: 'asc' },
    });
    return instances.map(toTaskInstanceResponse);
  }

  async update(
    userId: string,
    id: string,
    body: UpdateInstanceRequest,
  ): Promise<TaskInstanceResponse> {
    // Ownership gate: look up through the parent task's userId. Prisma
    // doesn't let us filter TaskInstance by `task.userId` + id in a
    // single findUnique, so a findFirst with the compound where is the
    // simplest safe form.
    const existing = await this.prisma.taskInstance.findFirst({
      where: { id, task: { userId } },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'instance_not_found' });
    }

    const data: Prisma.TaskInstanceUpdateInput = {
      completedAt: body.completedAt === null ? null : new Date(body.completedAt),
    };

    const row = await this.prisma.taskInstance.update({
      where: { id },
      data,
    });
    return toTaskInstanceResponse(row);
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/// ISO weekday: Mon=1 .. Sun=7. Date.getDay() returns Sun=0..Sat=6.
/// We compute from the already-wall-clocked y/m/d so DST never shifts
/// the day across a boundary. `Date.UTC` is correct here because we
/// just need the weekday; UTC-of-local-midnight has the same weekday
/// as the local day.
function isoWeekdayOf(year: number, month: number, day: number): number {
  const utcDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0..6, Sun=0
  return utcDow === 0 ? 7 : utcDow;
}

function toTaskInstanceResponse(row: PrismaTaskInstance): TaskInstanceResponse {
  return {
    id: row.id,
    taskId: row.taskId,
    scheduledDate: toYmd(row.scheduledDate),
    priority: row.priority,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
