import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import type {
  MeProfileResponse,
  UpdateMeProfileRequest,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// Data-access layer for `User` rows. Pure CRUD — no auth / hashing logic
/// (that lives in `auth/`). Used by AuthService and by the CLI commands.
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /// Case-insensitive lookup by email. Returns null if no row exists.
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /// True iff at least one user row exists. Used by AuthService to decide
  /// whether to emit the dev-mode `no_user_seeded` hint (Auth.md §6.2).
  async hasAnyUser(): Promise<boolean> {
    const first = await this.prisma.user.findFirst({ select: { id: true } });
    return first !== null;
  }

  /// Create a user with a pre-hashed password. The CLI seed/reset commands
  /// hash via PasswordService before calling this.
  create(input: {
    email: string;
    passwordHash: string;
    displayName?: string | null;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase().trim(),
        passwordHash: input.passwordHash,
        displayName: input.displayName ?? null,
      },
    });
  }

  /// Bare password-hash setter. Auth.md §4.7 / §6.3 callers are responsible
  /// for revoking refresh tokens separately if they want to log out devices.
  updatePasswordHash(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }

  count(): Promise<number> {
    return this.prisma.user.count();
  }

  listAll(): Promise<
    Pick<User, 'id' | 'email' | 'displayName' | 'createdAt'>[]
  > {
    return this.prisma.user.findMany({
      select: { id: true, email: true, displayName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  //  Profile (Settings.md §4.1, §6.3)
  // ---------------------------------------------------------------------------

  /// Read-side projection used by `GET /v1/me/profile`. Throws NotFound for a
  /// stale-token id so callers can map it to 404 without leaking which fields
  /// are missing.
  async getProfile(userId: string): Promise<MeProfileResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        birthday: true,
        lifeExpectancyYears: true,
        timezone: true,
        timezoneOverridden: true,
      },
    });
    if (!user) throw new NotFoundException({ error: 'user_not_found' });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : null,
      lifeExpectancyYears: user.lifeExpectancyYears,
      timezone: user.timezone,
      timezoneOverridden: user.timezoneOverridden,
    };
  }

  /// Partial profile update with the dual-flow timezone semantics from
  /// Settings.md §4.1.1:
  ///
  ///   * `autoDetect: true`  → silent backfill from the browser. Apply the
  ///     supplied timezone only when the user hasn't manually overridden, and
  ///     do NOT flip the override flag.
  ///   * `autoDetect: false` (default) → manual edit. Apply the timezone
  ///     unconditionally and set `timezoneOverridden = true`.
  ///
  /// IANA-validity is checked via `Intl.DateTimeFormat`, which throws
  /// `RangeError` on unknown zones. Returns the post-update projection so the
  /// caller can update its query cache without a second round trip.
  async updateProfile(
    userId: string,
    input: UpdateMeProfileRequest,
  ): Promise<MeProfileResponse> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezoneOverridden: true },
    });
    if (!current) throw new NotFoundException({ error: 'user_not_found' });

    const data: Prisma.UserUpdateInput = {};

    if (input.timezone !== undefined) {
      assertValidIanaTimezone(input.timezone);
      const auto = input.autoDetect === true;
      if (auto) {
        // Silent backfill: respect a prior manual override.
        if (!current.timezoneOverridden) {
          data.timezone = input.timezone;
        }
        // Either way: do NOT flip `timezoneOverridden`.
      } else {
        // Manual edit: always apply + mark overridden.
        data.timezone = input.timezone;
        data.timezoneOverridden = true;
      }
    }

    if (input.displayName !== undefined) {
      data.displayName = input.displayName;
    }
    if (input.birthday !== undefined) {
      data.birthday = input.birthday ? new Date(input.birthday) : null;
    }
    if (input.lifeExpectancyYears !== undefined) {
      data.lifeExpectancyYears = input.lifeExpectancyYears;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    return this.getProfile(userId);
  }
}

/// Cheap IANA-validity gate. `Intl.DateTimeFormat` throws `RangeError` on
/// unknown zones; we re-throw as a 400 so the client gets a clean error
/// shape instead of a 500. The check is sufficient for v1 — every IANA name
/// the browser knows about will pass, junk strings will not.
function assertValidIanaTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new BadRequestException({
      error: 'validation_failed',
      details: [{ path: 'timezone', message: `Unknown IANA timezone '${tz}'` }],
    });
  }
}
