import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateSectionRequest,
  SectionDeleteMode,
  SectionResponse,
  UpdateSectionRequest,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// User-defined task buckets (Tasks.md §3.1). Thin CRUD — no complex
/// validation beyond what Zod handles at the controller boundary. The
/// task-count aggregate lives here so every list caller gets the same
/// definition of "non-archived tasks assigned to this section" without
/// duplicating the predicate.
@Injectable()
export class SectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<SectionResponse[]> {
    // Section.position is the primary order axis (user-controlled). Ties
    // broken by createdAt so new sections always slot in deterministically.
    const rows = await this.prisma.section.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      // Count tasks on each section in one trip. `_count` is Prisma's
      // relation aggregator — one SQL query, no N+1.
      include: {
        _count: {
          select: {
            tasks: {
              where: { archivedAt: null },
            },
          },
        },
      },
    });
    return rows.map(toSectionResponse);
  }

  async create(
    userId: string,
    body: CreateSectionRequest,
  ): Promise<SectionResponse> {
    // Default position = max(position) + 1, keeping new sections at the
    // bottom unless the caller specifies otherwise. One SELECT MAX, not
    // a full table scan.
    const position =
      body.position ??
      ((
        await this.prisma.section.aggregate({
          where: { userId },
          _max: { position: true },
        })
      )._max.position ?? -1) + 1;

    const row = await this.prisma.section.create({
      data: {
        userId,
        name: body.name,
        color: body.color ?? '#9ca3af',
        position,
      },
      include: { _count: { select: { tasks: { where: { archivedAt: null } } } } },
    });
    return toSectionResponse(row);
  }

  async update(
    userId: string,
    sectionId: string,
    body: UpdateSectionRequest,
  ): Promise<SectionResponse> {
    // Scope-by-userId at the WHERE level so a cross-tenant update
    // returns 404 instead of silently succeeding.
    const existing = await this.prisma.section.findFirst({
      where: { id: sectionId, userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'section_not_found' });
    }

    const row = await this.prisma.section.update({
      where: { id: sectionId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.archivedAt !== undefined
          ? { archivedAt: body.archivedAt === null ? null : new Date(body.archivedAt) }
          : {}),
      },
      include: { _count: { select: { tasks: { where: { archivedAt: null } } } } },
    });
    return toSectionResponse(row);
  }

  /// Delete semantics per Tasks.md §5.3:
  ///  - mode="inbox":   move all tasks (including archived) to Inbox, then
  ///                    delete the section.
  ///  - mode="cascade": hard-delete every task in the section, then the
  ///                    section itself.
  /// No implicit default — the caller must pick. The query validator
  /// enforces this at the controller boundary.
  async remove(
    userId: string,
    sectionId: string,
    mode: SectionDeleteMode,
  ): Promise<void> {
    const existing = await this.prisma.section.findFirst({
      where: { id: sectionId, userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'section_not_found' });
    }

    // Atomic so a crash mid-move doesn't orphan tasks or leave the
    // section half-dead with dangling children.
    await this.prisma.$transaction(async (tx) => {
      if (mode === 'inbox') {
        await tx.task.updateMany({
          where: { sectionId, userId },
          data: { sectionId: null },
        });
      } else if (mode === 'cascade') {
        // Prisma cascades Task → TaskInstance via the schema's onDelete,
        // so deleting Tasks here is enough.
        await tx.task.deleteMany({ where: { sectionId, userId } });
      } else {
        // Defensive — the controller's Zod validator should have caught this.
        throw new BadRequestException({ error: 'section_delete_mode_required' });
      }
      await tx.section.delete({ where: { id: sectionId } });
    });
  }
}

// ponytail: structural helper used in list / create / update — keeps the
// response shape in one place so adding a field only touches here + the
// shared schema.
type SectionWithCount = Awaited<
  ReturnType<PrismaService['section']['findFirst']>
> extends infer _T
  ? {
      id: string;
      name: string;
      color: string;
      position: number;
      createdAt: Date;
      archivedAt: Date | null;
      _count: { tasks: number };
    }
  : never;

function toSectionResponse(row: SectionWithCount): SectionResponse {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    taskCount: row._count.tasks,
  };
}
