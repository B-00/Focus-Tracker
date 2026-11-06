import { Command, CommandRunner, Option } from 'nest-commander';
import { MaintenanceService } from '../tasks/maintenance.service';
import { PrismaService } from '../prisma/prisma.service';

interface Options {
  email?: string;
  userId?: string;
}

/// `pnpm --filter @focus-tracker/api nightly-maintenance [--email me@x.com]`
///
/// Runs the Tasks.md §5.5 Step 3 (transfer + backlog) over missed dated
/// single-day tasks. Default: all users. `--email` / `--user-id` scope
/// to a single user — useful for dev / tests.
///
/// Schedule this via Windows Task Scheduler / cron at ~05:00 UTC (after
/// local midnight for most of the world). Idempotent: re-running within
/// the same local day is a no-op since all newly-eligible tasks have
/// already moved.
@Command({
  name: 'nightly-maintenance',
  description:
    'Run the Tasks.md §5.5 nightly maintenance (Step 3 only until charts land).',
})
export class NightlyMaintenanceCommand extends CommandRunner {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async run(_args: string[], rawOptions: Options): Promise<void> {
    let targetUserIds: string[] | null = null;

    if (rawOptions.userId) {
      targetUserIds = [rawOptions.userId];
    } else if (rawOptions.email) {
      const u = await this.prisma.user.findUnique({
        where: { email: rawOptions.email.trim().toLowerCase() },
        select: { id: true },
      });
      if (!u) {
        throw new Error(`No user with email "${rawOptions.email}"`);
      }
      targetUserIds = [u.id];
    }

    const reports = targetUserIds
      ? await Promise.all(targetUserIds.map((id) => this.maintenance.runForUser(id)))
      : await this.maintenance.runForAllUsers();

    const totalTransferred = reports.reduce((s, r) => s + r.transferredCount, 0);
    const totalBacklogged = reports.reduce((s, r) => s + r.backloggedCount, 0);

    // eslint-disable-next-line no-console
    console.log(
      `\nnightly-maintenance complete:` +
        `\n  users processed: ${reports.length}` +
        `\n  transferred:     ${totalTransferred}` +
        `\n  backlogged:      ${totalBacklogged}` +
        (reports.length <= 5
          ? '\n' +
            reports
              .map(
                (r) =>
                  `    ${r.userId} (${r.tz}, ${r.today}): ` +
                  `transferred=${r.transferredCount} backlogged=${r.backloggedCount}`,
              )
              .join('\n')
          : '') +
        '\n',
    );
  }

  @Option({
    flags: '-e, --email <email>',
    description: 'Only process this user (by email).',
  })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '-u, --user-id <id>',
    description: 'Only process this user (by id).',
  })
  parseUserId(value: string): string {
    return value;
  }
}

// RunReport type lives on MaintenanceService internally; re-export not
// needed — CLI just consumes { transferredCount, backloggedCount, userId, tz, today }.
