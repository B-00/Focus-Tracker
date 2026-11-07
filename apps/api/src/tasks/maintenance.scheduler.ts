import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MaintenanceService } from './maintenance.service';

/// In-process trigger for the Tasks.md §5.5 nightly job. Fires at
/// 05:00 UTC daily (after local midnight for every reasonable
/// timezone) and once on API startup.
///
/// Why bootstrap-fire too? If the API was down at 05:00 UTC, the
/// cron tick gets missed. Firing on startup catches up the next time
/// you bring the server up. Safe because every step is idempotent
/// (createMany skipDuplicates for Step 1, upsert for Steps 2/4,
/// mutually-exclusive partition for Step 3) — re-running the same
/// day is a no-op.
///
/// The CLI command (`pnpm --filter @focus-tracker/api nightly-
/// maintenance`) stays available as a manual escape hatch for force-
/// runs during dev / testing / debugging. Both the cron and the CLI
/// call the same MaintenanceService.runForAllUsers() so there's only
/// one code path to reason about.
///
/// Day-tracking watermark lives in the two daily-score tables
/// (max(date) per user). No separate "last-run" log is needed —
/// MaintenanceService reads this on each run to decide where to
/// resume. MAX_CATCHUP_DAYS caps worst-case loop size.
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
      const sum = (pick: (r: (typeof reports)[number]) => number) =>
        reports.reduce((s, r) => s + pick(r), 0);
      this.logger.log(
        `${trigger}: processed ${reports.length} users, ` +
          `days=${sum((r) => r.daysProcessed)} ` +
          `routineInst+=${sum((r) => r.routineInstancesCreated)} ` +
          `datedScore=${sum((r) => r.datedScoreRowsUpserted)} ` +
          `routineScore=${sum((r) => r.routineScoreRowsUpserted)} ` +
          `transferred=${sum((r) => r.transferredCount)} ` +
          `backlogged=${sum((r) => r.backloggedCount)}`,
      );
    } catch (err) {
      this.logger.error(
        `${trigger}: nightly maintenance failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
