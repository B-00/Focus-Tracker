import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LifeService } from './life.service';

/// In-process scheduler for the life-grid aggregation job
/// (MementoMori.md §6.2 — "a sibling job in the same scheduled service"
/// as the task-maintenance nightly). Fires:
///
///   * once on application bootstrap, so the server catches up after any
///     downtime without waiting for the next 05:00 UTC tick;
///   * daily at 05:10 UTC, offset from the Tasks nightly (05:00) so the
///     two jobs don't contend for the same DB connections.
///
/// `refreshForAllUsers()` is idempotent — re-running produces identical
/// rows — so missing or duplicate fires are safe. The on-read refresh in
/// `LifeService.getGrid` provides a per-request fallback for current-week
/// freshness between runs.
@Injectable()
export class LifeScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LifeScheduler.name);

  constructor(private readonly life: LifeService) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('bootstrap: refreshing life grid for all users');
    void this.runOnce('bootstrap');
  }

  /// 05:10 UTC daily. 10-minute offset from the tasks maintenance cron
  /// (05:00 UTC) so the two jobs don't fight for connections on a
  /// shared pool in a small single-instance deployment.
  @Cron('10 5 * * *', { timeZone: 'UTC' })
  async dailyTick(): Promise<void> {
    await this.runOnce('cron');
  }

  private async runOnce(trigger: 'bootstrap' | 'cron'): Promise<void> {
    try {
      const { users, weeksWritten } = await this.life.refreshForAllUsers();
      this.logger.log(
        `${trigger}: refreshed ${users} user(s), ${weeksWritten} week row(s) upserted`,
      );
    } catch (err) {
      this.logger.error(
        `${trigger}: life-grid refresh failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
