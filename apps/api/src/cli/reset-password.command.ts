import { Command, CommandRunner, InquirerService, Option } from 'nest-commander';
import { passwordSchema } from '@focus-tracker/shared';
import { UsersService } from '../users/users.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';

interface ResetPasswordOptions {
  email?: string;
  password?: string;
}

/// `pnpm --filter @focus-tracker/api reset-password --email <email> [--password <pw>]`
///
/// Auth.md §6.3. Replaces the user's password hash AND revokes every refresh
/// token for that user (no opt-out — if you needed the CLI, normal access is
/// already lost).
@Command({
  name: 'reset-password',
  description: 'Reset a user password and revoke all of their refresh tokens.',
})
export class ResetPasswordCommand extends CommandRunner {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly prisma: PrismaService,
    private readonly inquirer: InquirerService,
  ) {
    super();
  }

  async run(_args: string[], raw: ResetPasswordOptions): Promise<void> {
    const email = (raw.email ?? '').trim().toLowerCase();
    if (!email) {
      throw new Error('--email is required.');
    }

    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new Error(`No user with email "${email}".`);
    }

    let password = raw.password ?? '';
    if (!password) {
      const answers = await this.inquirer.ask<{ password: string }>('password-prompt', undefined);
      password = answers.password;
    }
    const pwResult = passwordSchema.safeParse(password);
    if (!pwResult.success) {
      throw new Error(`Invalid password: ${pwResult.error.issues[0]?.message ?? 'unknown'}`);
    }

    const hash = await this.passwords.hash(password);
    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hash },
      });
      const r = await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return r.count;
    });

    // eslint-disable-next-line no-console
    console.log(
      `\nReset password for ${user.email}. Revoked ${revoked} active refresh token(s).\n`,
    );
  }

  @Option({ flags: '-e, --email <email>', description: 'User email to reset.' })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '-p, --password <password>',
    description: 'New password (prompts if omitted).',
  })
  parsePassword(value: string): string {
    return value;
  }
}
