import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Task as PrismaTask, Prisma } from '@prisma/client';
import type {
  CreateTaskRequest,
  ListTasksQuery,
  TaskResponse,
  UpdateTaskRequest,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// Tasks CRUD. Supports all three kinds (dated / ongoing / routine).
/// Routine completion lives on `TaskInstance` (see InstancesService),
/// not on the Task row itself — the service enforces that by refusing
/// to write `completedAt` on routines here.
///
/// Validation layering:
///  * Shape validation (strings, enums, discriminated union) lives in
///    `@focus-tracker/shared` zod schemas and runs at the controller.
///  * Semantic validation (per-kind rules, FK existence, immutability)
///    lives here — Zod can't check whether a `sectionId` actually
///    belongs to this user, and shouldn't try.
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  //  GET /v1/tasks
  // -------------------------------------------------------------------------

  async list(userId: string, query: ListTasksQuery): Promise<TaskResponse[]> {
    const where: Prisma.TaskWhereInput = {
      userId,
      // Default: hide archived + backlog unless the caller opts in.
      ...(query.archived ? {} : { archivedAt: null }),
      ...(query.backlog ? {} : { inBacklog: false }),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.sectionId !== undefined
        ? { sectionId: query.sectionId === 'inbox' ? null : query.sectionId }
        : {}),
    };

    const rows = await this.prisma.task.findMany({
      where,
      // Primary sort = priority DESC (extreme → low) per Tasks.md §4.1.
      // Secondary = createdAt ASC so stable ties by age. UI may re-sort
      // by startDate for the Dated panel, but having a sensible default
      // on the server reduces client-side churn.
      orderBy: [
        // Postgres sorts enums by declaration order (schema.prisma lists
        // low/mid/high/extreme in that order), so we use a $raw ORDER BY
        // in the materialised view... except Prisma doesn't give us that
        // in findMany. Instead we map priority → numeric weight at read
        // time in the client (TaskRow sort). Here we fall back to
        // priority ASC (which lands low→extreme) and the client flips it.
        //
        // ponytail: good enough for Slice 1 at <10k rows/user. If this
        // ever becomes a bottleneck we'd migrate to a raw query with
        // CASE priority WHEN 'extreme' THEN 4 ... ORDER BY that DESC.
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
    });
    return rows.map(toTaskResponse);
  }

  async getById(userId: string, id: string): Promise<TaskResponse> {
    const row = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!row) {
      throw new NotFoundException({ error: 'task_not_found' });
    }
    return toTaskResponse(row);
  }

  // -------------------------------------------------------------------------
  //  POST /v1/tasks
  // -------------------------------------------------------------------------

  async create(userId: string, body: CreateTaskRequest): Promise<TaskResponse> {
    if (body.sectionId !== undefined && body.sectionId !== null) {
      await this.assertSectionBelongsToUser(userId, body.sectionId);
    }

    const data: Prisma.TaskCreateInput = {
      user: { connect: { id: userId } },
      kind: body.kind,
      priority: body.priority,
      title: body.title,
      description: body.description ?? null,
      ...(body.sectionId !== undefined && body.sectionId !== null
        ? { section: { connect: { id: body.sectionId } } }
        : {}),
    };

    if (body.kind === 'dated') {
      const startDate = toDbDate(body.startDate);
      const endDate =
        body.endDate !== undefined && body.endDate !== null ? toDbDate(body.endDate) : null;
      const singleDay = endDate === null || endDate.getTime() === startDate.getTime();
      if (body.transferIfMissed === true && !singleDay) {
        // Tasks.md §3.2 "Per-kind rules" — the flag is semantically
        // single-day only; silently ignoring would be surprising.
        throw new BadRequestException({
          error: 'transfer_requires_single_day',
          message: 'transferIfMissed=true is only valid on single-day dated tasks',
        });
      }
      data.startDate = startDate;
      data.endDate = endDate;
      data.transferIfMissed = body.transferIfMissed ?? false;
    } else if (body.kind === 'routine') {
      // Dedupe the picker — [1,1,3] from a wonky client → [1,3].
      // Also sort so storage order matches wire order; cheap and
      // keeps "did you edit the cadence" comparisons trivial.
      data.routineDaysOfWeek = Array.from(new Set(body.routineDaysOfWeek)).sort(
        (a, b) => a - b,
      );
      data.routineStartDate =
        body.routineStartDate !== undefined ? toDbDate(body.routineStartDate) : null;
      data.routineEndDate =
        body.routineEndDate !== undefined && body.routineEndDate !== null
          ? toDbDate(body.routineEndDate)
          : null;
      // Routines complete per-instance; the Task row's `completedAt`
      // stays null forever. Enforced by the update() handler.
    }
    // 'ongoing' leaves all date / routine fields at their schema defaults.

    const row = await this.prisma.task.create({ data });
    return toTaskResponse(row);
  }

  // -------------------------------------------------------------------------
  //  PATCH /v1/tasks/:id
  // -------------------------------------------------------------------------

  async update(
    userId: string,
    id: string,
    body: UpdateTaskRequest,
  ): Promise<TaskResponse> {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
      select: {
        id: true,
        kind: true,
        startDate: true,
        endDate: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'task_not_found' });
    }

    const isRoutine = existing.kind === 'routine';
    const touchesRoutineFields =
      body.routineDaysOfWeek !== undefined ||
      body.routineStartDate !== undefined ||
      body.routineEndDate !== undefined;

    // Routine fields only valid on routine tasks.
    if (!isRoutine && touchesRoutineFields) {
      throw new BadRequestException({
        error: 'kind_immutable',
        message: 'Routine fields are only editable on routine tasks',
      });
    }

    // Date / completion / transfer are not valid on routines — those
    // live on TaskInstance (completion) or aren't applicable (dates,
    // transfer-if-missed). Keeps the Task row consistent with §3.2.
    if (
      isRoutine &&
      (body.startDate !== undefined ||
        body.endDate !== undefined ||
        body.completedAt !== undefined ||
        body.transferIfMissed !== undefined)
    ) {
      throw new BadRequestException({
        error: 'kind_immutable',
        message:
          'Dated / completion / transfer fields are not valid on routine tasks',
      });
    }

    // Validate section FK if the caller is moving sections.
    if (body.sectionId !== undefined && body.sectionId !== null) {
      await this.assertSectionBelongsToUser(userId, body.sectionId);
    }

    // transferIfMissed single-day guard, same rule as create.
    if (body.transferIfMissed === true) {
      const nextStart =
        body.startDate !== undefined
          ? toDbDate(body.startDate)
          : (existing.startDate ?? null);
      const nextEnd =
        body.endDate !== undefined
          ? body.endDate === null
            ? null
            : toDbDate(body.endDate)
          : (existing.endDate ?? null);
      if (nextStart === null) {
        throw new BadRequestException({
          error: 'transfer_requires_single_day',
          message: 'transferIfMissed=true is only valid on dated tasks',
        });
      }
      if (nextEnd !== null && nextEnd.getTime() !== nextStart.getTime()) {
        throw new BadRequestException({
          error: 'transfer_requires_single_day',
          message: 'transferIfMissed=true is only valid on single-day dated tasks',
        });
      }
    }

    const data: Prisma.TaskUpdateInput = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.sectionId !== undefined
        ? body.sectionId === null
          ? { section: { disconnect: true } }
          : { section: { connect: { id: body.sectionId } } }
        : {}),
      ...(body.startDate !== undefined ? { startDate: toDbDate(body.startDate) } : {}),
      ...(body.endDate !== undefined
        ? { endDate: body.endDate === null ? null : toDbDate(body.endDate) }
        : {}),
      ...(body.completedAt !== undefined
        ? { completedAt: body.completedAt === null ? null : new Date(body.completedAt) }
        : {}),
      ...(body.transferIfMissed !== undefined
        ? { transferIfMissed: body.transferIfMissed }
        : {}),
      // Routine-only fields. Editing cadence takes effect for *future*
      // instances only — existing TaskInstance rows are preserved so
      // the consistency chart's history stays honest (Tasks.md §5.1).
      ...(body.routineDaysOfWeek !== undefined
        ? {
            routineDaysOfWeek: Array.from(new Set(body.routineDaysOfWeek)).sort(
              (a, b) => a - b,
            ),
          }
        : {}),
      ...(body.routineStartDate !== undefined
        ? { routineStartDate: toDbDate(body.routineStartDate) }
        : {}),
      ...(body.routineEndDate !== undefined
        ? {
            routineEndDate:
              body.routineEndDate === null ? null : toDbDate(body.routineEndDate),
          }
        : {}),
      ...(body.archivedAt !== undefined
        ? { archivedAt: body.archivedAt === null ? null : new Date(body.archivedAt) }
        : {}),
    };

    const row = await this.prisma.task.update({
      where: { id },
      data,
    });
    return toTaskResponse(row);
  }

  // -------------------------------------------------------------------------
  //  DELETE /v1/tasks/:id
  // -------------------------------------------------------------------------

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'task_not_found' });
    }
    // Prisma cascades Task → TaskInstance via the schema.
    await this.prisma.task.delete({ where: { id } });
  }

  // -------------------------------------------------------------------------
  //  Private helpers
  // -------------------------------------------------------------------------

  private async assertSectionBelongsToUser(
    userId: string,
    sectionId: string,
  ): Promise<void> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, userId },
      select: { id: true },
    });
    if (!section) {
      throw new NotFoundException({ error: 'section_not_found' });
    }
  }
}

// ---------------------------------------------------------------------------
//  Serialisation helpers
// ---------------------------------------------------------------------------

/// Convert a `YYYY-MM-DD` string into a `Date` anchored at midnight UTC.
/// Postgres stores `@db.Date` without a time component, so the UTC vs
/// local distinction doesn't matter for storage — but creating it via
/// `new Date('2026-10-26')` is UTC-safe (vs `new Date('2026-10-26T00:00:00')`
/// which is local-time and can shift the stored day on some TZs).
function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/// Opposite direction — Postgres gives us a Date at UTC-midnight; we want
/// `YYYY-MM-DD` on the wire. Slicing `toISOString().slice(0, 10)` is the
/// idiomatic one-liner and matches the activity module's convention.
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toTaskResponse(row: PrismaTask): TaskResponse {
  return {
    id: row.id,
    sectionId: row.sectionId,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    description: row.description,
    startDate: row.startDate ? toYmd(row.startDate) : null,
    endDate: row.endDate ? toYmd(row.endDate) : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    routineDaysOfWeek: row.routineDaysOfWeek,
    routineStartDate: row.routineStartDate ? toYmd(row.routineStartDate) : null,
    routineEndDate: row.routineEndDate ? toYmd(row.routineEndDate) : null,
    transferIfMissed: row.transferIfMissed,
    transferredFromDate: row.transferredFromDate ? toYmd(row.transferredFromDate) : null,
    inBacklog: row.inBacklog,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
