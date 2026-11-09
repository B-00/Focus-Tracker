import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import type {
  DashboardPrefsResponse,
  MeProfileResponse,
  UiPrefs,
  UpdateDashboardPrefsRequest,
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
      select: { timezoneOverridden: true, birthday: true },
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
    let birthdayChanged = false;
    if (input.birthday !== undefined) {
      const nextBirthday = input.birthday ? new Date(input.birthday) : null;
      data.birthday = nextBirthday;
      // Compare to the currently stored value — both may be null.
      const prevMs = current.birthday ? current.birthday.getTime() : null;
      const nextMs = nextBirthday ? nextBirthday.getTime() : null;
      birthdayChanged = prevMs !== nextMs;
    }
    if (input.lifeExpectancyYears !== undefined) {
      data.lifeExpectancyYears = input.lifeExpectancyYears;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }

    // Changing birthday shifts every weekIndex, so the per-week
    // aggregates keyed on the old birthday are now stale ghosts in the
    // life grid. Drop them; the next GET /v1/life/grid triggers the
    // on-read refresh which re-aggregates against the new birthday.
    // ponytail: deletion here (vs calling LifeService) keeps UsersService
    // free of cross-module wiring; the life-grid read path self-heals.
    // Milestones/WeekNotes are intentionally untouched — those are
    // user-entered against a specific life-week semantic, not a
    // computed cache, so a birthday change CAN shift what real date
    // they refer to (acceptable in v1; migration logic would be a
    // separate feature).
    if (birthdayChanged) {
      await this.prisma.weekActivityMinutes.deleteMany({ where: { userId } });
    }

    return this.getProfile(userId);
  }

  // ---------------------------------------------------------------------------
  //  Dashboard Prefs (Dashboard.md §9)
  // ---------------------------------------------------------------------------

  /// Read-side projection used by `GET /v1/me/dashboard-prefs`. Returns empty
  /// arrays (NOT 404) when the row doesn't exist yet — the client then merges
  /// with its code-side defaults, so a fresh account "just works".
  async getDashboardPrefs(userId: string): Promise<DashboardPrefsResponse> {
    const row = await this.prisma.userDashboardPrefs.findUnique({
      where: { userId },
      select: {
        widgetOrder: true,
        hiddenWidgets: true,
        collapsedWidgets: true,
      },
    });
    return {
      widgetOrder: row?.widgetOrder ?? [],
      hiddenWidgets: row?.hiddenWidgets ?? [],
      collapsedWidgets: row?.collapsedWidgets ?? [],
    };
  }

  /// Full-replace upsert used by `PUT /v1/me/dashboard-prefs`. The client
  /// always has the complete state in hand (it's the only writer), so no
  /// partial-merge semantics. Undefined arrays default to [] on write so the
  /// client can send only the field it owns (`widgetOrder`) today and we add
  /// hide/collapse controls later without a wire change.
  async upsertDashboardPrefs(
    userId: string,
    input: UpdateDashboardPrefsRequest,
  ): Promise<DashboardPrefsResponse> {
    const widgetOrder = dedupe(input.widgetOrder);
    const hiddenWidgets = dedupe(input.hiddenWidgets ?? []);
    const collapsedWidgets = dedupe(input.collapsedWidgets ?? []);
    await this.prisma.userDashboardPrefs.upsert({
      where: { userId },
      create: { userId, widgetOrder, hiddenWidgets, collapsedWidgets },
      update: { widgetOrder, hiddenWidgets, collapsedWidgets },
    });
    return { widgetOrder, hiddenWidgets, collapsedWidgets };
  }

  // ---------------------------------------------------------------------------
  //  UI Prefs (shared/ui-prefs.ts)
  // ---------------------------------------------------------------------------

  async getUiPrefs(userId: string): Promise<UiPrefs> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { uiPrefs: true },
    });
    if (!row) throw new NotFoundException({ error: 'user_not_found' });
    return row.uiPrefs as UiPrefs;
  }

  /// Top-level merge via jsonb `||` in one statement — atomic, so two
  /// stores PATCHing different slices at once can't lose each other's write.
  async patchUiPrefs(userId: string, input: UiPrefs): Promise<UiPrefs> {
    const rows = await this.prisma.$queryRaw<{ uiPrefs: UiPrefs }[]>`
      UPDATE "User" SET "uiPrefs" = "uiPrefs" || ${JSON.stringify(input)}::jsonb
      WHERE id = ${userId} RETURNING "uiPrefs"`;
    if (!rows[0]) throw new NotFoundException({ error: 'user_not_found' });
    return rows[0].uiPrefs;
  }
}

/// Stable-order de-dupe. Protects the DB from a buggy client sending the
/// same widget ID twice (which would then double-render on read).
function dedupe(xs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
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
