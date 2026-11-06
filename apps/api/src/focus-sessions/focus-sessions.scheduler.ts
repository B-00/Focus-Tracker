import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FocusSessionsService } from './focus-sessions.service';

/// In-process schedulers for the two server-driven session lifecycle paths:
///
///   * Timer-expiry: every 10s, auto-complete timer-mode sessions whose
///     accumulated running time has reached `plannedDurationMs`. Server is
///     authoritative so the session ends on time even if the client is
///     offline (FocusSession.md §9.5).
///
///   * Stale-abort: hourly, mark running/paused sessions older than 24h as
///     `aborted` to protect downstream aggregates (Memento Mori weekly
///     shading, Calendar session counts) from phantom multi-day sessions
///     (FocusSession.md §9.8).
///
/// Both are single-tick idempotent — re-running finds zero candidates.
/// Errors are swallowed-and-logged so a bad run never takes the API down.
@Injectable()
export class FocusSessionsScheduler {
  private readonly logger = new Logger(FocusSessionsScheduler.name);

  constructor(private readonly sessions: FocusSessionsService) {}

  /// Every 10s. Short cadence is OK — the candidate query is a bounded
  /// findMany on an indexed partial set (state in (running,paused) AND
  /// plannedDurationMs IS NOT NULL — usually zero rows).
  @Cron(CronExpression.EVERY_10_SECONDS)
  async timerExpiryTick(): Promise<void> {
    try {
      const { expired } = await this.sessions.expireDueTimers();
      if (expired > 0) {
        this.logger.log(`timer-expiry: completed ${expired} session(s)`);
      }
    } catch (err) {
      this.logger.error(
        'timer-expiry tick failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /// Hourly. 24h is the abort threshold, so once/hour is plenty — being
  /// late by up to 59 minutes doesn't matter for an already-phantom session.
  @Cron(CronExpression.EVERY_HOUR)
  async staleAbortTick(): Promise<void> {
    try {
      const { aborted } = await this.sessions.abortStaleSessions();
      if (aborted > 0) {
        this.logger.log(`stale-abort: aborted ${aborted} session(s) (>24h)`);
      }
    } catch (err) {
      this.logger.error(
        'stale-abort tick failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
