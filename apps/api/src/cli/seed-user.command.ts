import { Command, CommandRunner, InquirerService, Option, Question, QuestionSet } from 'nest-commander';
import { z } from 'zod';
import { passwordSchema } from '@focus-tracker/shared';
import { UsersService } from '../users/users.service';
import { PasswordService } from '../auth/password.service';

interface SeedUserOptions {
  email?: string;
  password?: string;
  displayName?: string;
}

const emailSchema = z.string().email();

/// `pnpm --filter @focus-tracker/api seed-user --email <email> [--password <pw>] [--display-name <name>]`
///
/// Auth.md §6.1. Creates the initial user row. Refuses if a user with the
/// same email already exists — use `reset-password` for that case.
@Command({
  name: 'seed-user',
  description: 'Create the initial user account.',
})
export class SeedUserCommand extends CommandRunner {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly inquirer: InquirerService,
  ) {
    super();
  }

  async run(_args: string[], rawOptions: SeedUserOptions): Promise<void> {
    const opts = await this.resolveOptions(rawOptions);

    const existing = await this.users.findByEmail(opts.email);
    if (existing) {
      throw new Error(
        `A user with email "${opts.email}" already exists. ` +
          `Use \`pnpm --filter @focus-tracker/api reset-password\` to change their password.`,
      );
    }

    const hash = await this.passwords.hash(opts.password);
    const user = await this.users.create({
      email: opts.email,
      passwordHash: hash,
      displayName: opts.displayName ?? deriveDisplayName(opts.email),
    });

    // eslint-disable-next-line no-console
    console.log(
      `\nSeeded user:\n  id:          ${user.id}\n  email:       ${user.email}\n  displayName: ${user.displayName ?? '(none)'}\n`,
    );
  }

  // ----------------------------------------------------------------
  //  Option resolution: prefer flags, fall back to env, then prompt.
  // ----------------------------------------------------------------
  private async resolveOptions(
    raw: SeedUserOptions,
  ): Promise<{ email: string; password: string; displayName?: string }> {
    const email = (raw.email ?? process.env.SEED_USER_EMAIL ?? '').trim();
    const password = raw.password ?? process.env.SEED_USER_PASSWORD ?? '';
    const displayName = raw.displayName?.trim() || undefined;

    // Email is required up front so we can prompt for the password cleanly.
    if (!email) {
      throw new Error('--email is required (or set SEED_USER_EMAIL).');
    }
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      throw new Error(`Invalid email: ${emailResult.error.issues[0]?.message ?? 'unknown'}`);
    }

    let finalPassword = password;
    if (!finalPassword) {
      const answers = await this.inquirer.ask<{ password: string }>('password-prompt', undefined);
      finalPassword = answers.password;
    }
    const pwResult = passwordSchema.safeParse(finalPassword);
    if (!pwResult.success) {
      throw new Error(`Invalid password: ${pwResult.error.issues[0]?.message ?? 'unknown'}`);
    }

    return { email: email.toLowerCase(), password: finalPassword, displayName };
  }

  @Option({ flags: '-e, --email <email>', description: 'User email (or set SEED_USER_EMAIL).' })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '-p, --password <password>',
    description: 'User password (or set SEED_USER_PASSWORD; prompts if omitted).',
  })
  parsePassword(value: string): string {
    return value;
  }

  @Option({
    flags: '-n, --display-name <name>',
    description: 'Display name. Defaults to the local-part of the email.',
  })
  parseDisplayName(value: string): string {
    return value;
  }
}

/// Inquirer prompt set for the hidden password input. Used when --password
/// is omitted and SEED_USER_PASSWORD is not set.
@QuestionSet({ name: 'password-prompt' })
export class PasswordPromptQuestions {
  @Question({
    type: 'password',
    name: 'password',
    message: 'Password (input hidden):',
    mask: '*',
  })
  parsePassword(value: string): string {
    return value;
  }
}

function deriveDisplayName(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}
