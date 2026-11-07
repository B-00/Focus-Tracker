import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateMilestoneRequest,
  Milestone,
  UpdateMilestoneRequest,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

// Milestones CRUD for the Memento Mori life grid
// (MementoMori.md §3.4 / §7).
//
// Ownership is enforced on every read + write via the (userId, id)
// scope — handlers never trust an id without pairing it to the
// authenticated user. `weekIndex` is derived from the user's birthday
// at response time so the client can bin markers by week without
// re-doing the math.
//
// birthday absence is a 400 rather than 404 — the user exists, the
// Memento Mori feature just hasn't been configured. Same shape as
// LifeService.getGrid's empty-state handling.

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

@Injectable()
export class MilestonesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Milestone[]> {
    const birthday = await this.requireBirthday(userId);
    const rows = await this.prisma.milestone.findMany({
      where: { userId },
      orderBy: { targetDate: 'asc' },
    });
    return rows.map((r) => this.serialize(r, birthday));
  }

  async create(
    userId: string,
    input: CreateMilestoneRequest,
  ): Promise<Milestone> {
    const birthday = await this.requireBirthday(userId);
    const target = this.parseYmdOrThrow(input.targetDate);

    const row = await this.prisma.milestone.create({
      data: {
        userId,
        targetDate: target,
        label: input.label,
        color: input.color,
        icon: input.icon ?? null,
      },
    });
    return this.serialize(row, birthday);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateMilestoneRequest,
  ): Promise<Milestone> {
    // Empty PATCH body = accidental no-op; reject early with a coded
    // error so the client doesn't swallow a user mistake.
    const hasAnyField =
      input.targetDate !== undefined ||
      input.label !== undefined ||
      input.color !== undefined ||
      input.icon !== undefined;
    if (!hasAnyField) throw new BadRequestException('empty_update');

    const birthday = await this.requireBirthday(userId);

    // Ownership guard: filter by (id, userId) and let updateMany's
    // count tell us whether anything matched. This is one DB round-trip
    // and it's immune to a malicious attempt to update someone else's
    // milestone by id.
    const next: Record<string, unknown> = {};
    if (input.targetDate !== undefined) {
      next.targetDate = this.parseYmdOrThrow(input.targetDate);
    }
    if (input.label !== undefined) next.label = input.label;
    if (input.color !== undefined) next.color = input.color;
    if (input.icon !== undefined) next.icon = input.icon;

    const upd = await this.prisma.milestone.updateMany({
      where: { id, userId },
      data: next,
    });
    if (upd.count === 0) throw new NotFoundException('milestone_not_found');

    // Re-fetch the row to return the canonical (serialized) shape. One
    // extra query per update is fine — this endpoint is cold.
    const row = await this.prisma.milestone.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('milestone_not_found');
    return this.serialize(row, birthday);
  }

  async delete(userId: string, id: string): Promise<void> {
    const del = await this.prisma.milestone.deleteMany({
      where: { id, userId },
    });
    if (del.count === 0) throw new NotFoundException('milestone_not_found');
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

  private async requireBirthday(userId: string): Promise<Date> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthday: true },
    });
    if (!user) throw new NotFoundException('user_not_found');
    if (!user.birthday) throw new BadRequestException('birthday_not_set');
    return user.birthday;
  }

  /// Parse a yyyy-mm-dd string into a UTC-midnight Date, rejecting
  /// anything that doesn't round-trip (e.g. 2026-02-30 which Date
  /// silently normalises to March 2). Mirrors the frontend's
  /// parseBirthday guard so client + server agree on what "valid" is.
  private parseYmdOrThrow(ymd: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) throw new BadRequestException('invalid_date');
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const t = Date.UTC(y, mo, d);
    const back = new Date(t);
    if (
      back.getUTCFullYear() !== y ||
      back.getUTCMonth() !== mo ||
      back.getUTCDate() !== d
    ) {
      throw new BadRequestException('invalid_date');
    }
    return back;
  }

  private serialize(
    row: {
      id: string;
      targetDate: Date;
      label: string;
      color: string;
      icon: string | null;
      createdAt: Date;
    },
    birthday: Date,
  ): Milestone {
    const b = Date.UTC(
      birthday.getUTCFullYear(),
      birthday.getUTCMonth(),
      birthday.getUTCDate(),
    );
    const weekIndex = Math.max(
      0,
      Math.floor((row.targetDate.getTime() - b) / MS_PER_WEEK),
    );
    return {
      id: row.id,
      targetDate: row.targetDate.toISOString().slice(0, 10),
      weekIndex,
      label: row.label,
      color: row.color,
      icon: row.icon,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
