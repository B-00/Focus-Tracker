import { Command, CommandRunner, Option } from 'nest-commander';
import { MaintenanceService } from '../tasks/maintenance.service';
import { PrismaService } from '../prisma/prisma.service';

interface Options {
  email?: string;
  userId?: string;
}

/// `pnpm --filter @focus-tracker/api nightly-maintenance [--email me@x.com]`
///
/// Runs the full Tasks.md §5.5 nightly maintenance: Step 1 (routine
/// instance materialisation) → Step 2 (dated score snapshot) → Step 3
/// (transfer + backlog) → Step 4 (routine score snapshot), per day, for
/// each user. Default: all users. `--email` / `--user-id` scope to one.
///
/// Normally driven by MaintenanceScheduler (@Cron EVERY_DAY_AT_5AM +
/// bootstrap-fire). This CLI stays available as a manual escape hatch
/// for dev / testing / debugging. Idempotent — safe to re-run.
@Command({
  name: 'nightly-maintenance',
  description:
    'Run the Tasks.md §5.5 nightly maintenance (all four steps).',
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

    const sum = (pick: (r: (typeof reports)[number]) => number) =>
      reports.reduce((s, r) => s + pick(r), 0);

    // eslint-disable-next-line no-console
    console.log(
      `\nnightly-maintenance complete:` +
        `\n  users processed:      ${reports.length}` +
        `\n  days processed:       ${sum((r) => r.daysProcessed)}` +
        `\n  routine instances +=  ${sum((r) => r.routineInstancesCreated)}` +
        `\n  dated score rows:     ${sum((r) => r.datedScoreRowsUpserted)}` +
        `\n  routine score rows:   ${sum((r) => r.routineScoreRowsUpserted)}` +
        `\n  transferred:          ${sum((r) => r.transferredCount)}` +
        `\n  backlogged:           ${sum((r) => r.backloggedCount)}` +
        (reports.length <= 5
          ? '\n' +
            reports
              .map(
                (r) =>
                  `    ${r.userId} (${r.tz}, today=${r.today}): ` +
                  `days=${r.daysProcessed}` +
                  (r.firstProcessedDay && r.lastProcessedDay
                    ? ` [${r.firstProcessedDay}..${r.lastProcessedDay}]`
                    : ''),
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

// RunReport type lives on MaintenanceService internally; the CLI just
// reads the public counter fields it returns.
