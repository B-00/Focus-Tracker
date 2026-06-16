import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
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
}
