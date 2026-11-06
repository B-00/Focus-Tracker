import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MaintenanceService } from './maintenance.service';

/// In-process trigger for the Tasks.md §5.5 nightly job. Fires at
/// 05:00 UTC daily (after local midnight for every reasonable
/// timezone) and once on API startup.
///
/// Why bootstrap-fire too? If the API was down at 05:00 UTC, the
/// cron tick gets missed. Firing on startup catches up the next time
/// you bring the server up. Safe because Step 3 (the only step we
/// run right now) is idempotent — re-running the same day is a no-op.
///
/// The CLI command (`pnpm --filter @focus-tracker/api nightly-
/// maintenance`) stays available as a manual escape hatch for force-
/// runs during dev / testing / debugging. Both the cron and the CLI
/// call the same MaintenanceService.runForAllUsers() so there's only
/// one code path to reason about.
///
/// ponytail: no "last-run" tracking table. Fine for Slice 3 because
/// transfer+backlog is self-correcting. Slice 5's daily-score steps
/// will need honest day-tracking (missed days must be back-computed);
/// at that point promote this to a per-user, per-date log and gate
/// each day's work on the log. Upgrade path noted here, not built
/// speculatively.
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(private readonly maintenance: MaintenanceService) {}

  /// Fires once when the API finishes booting. Non-blocking — we
  /// don't want a slow DB write to delay the server accepting
  /// requests. Errors are swallowed-and-logged so a single bad run
  /// never takes the API down.
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('bootstrap: running nightly maintenance (catch-up)');
    void this.runOnce('bootstrap');
  }

  /// 05:00 UTC daily. After local midnight for every IANA zone from
  /// UTC-11 (Pacific) through UTC+14 (Kiribati). Users in UTC+14
  /// would see their day flip at ~19:00 UTC, so the job never lands
  /// mid-day for anyone. The per-user tz resolution inside the
  /// service itself handles local "yesterday" correctly regardless.
  @Cron(CronExpression.EVERY_DAY_AT_5AM, { timeZone: 'UTC' })
  async nightlyTick(): Promise<void> {
    await this.runOnce('cron');
  }

  private async runOnce(trigger: 'bootstrap' | 'cron'): Promise<void> {
    try {
      const reports = await this.maintenance.runForAllUsers();
      const transferred = reports.reduce((s, r) => s + r.transferredCount, 0);
      const backlogged = reports.reduce((s, r) => s + r.backloggedCount, 0);
      this.logger.log(
        `${trigger}: processed ${reports.length} users, ` +
          `transferred=${transferred} backlogged=${backlogged}`,
      );
    } catch (err) {
      this.logger.error(
        `${trigger}: nightly maintenance failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
