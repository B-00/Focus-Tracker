import { Module } from '@nestjs/common';
import { LifeController } from './life.controller';
import { LifeScheduler } from './life.scheduler';
import { LifeService } from './life.service';
import { LifeWeekService } from './life-week.service';

/// Owns `/v1/life/*` + the week_activity_minutes maintenance job
/// (MementoMori.md §6).
///
/// LifeService (grid aggregation) and LifeWeekService (per-week drawer
/// drilldown — spec §5.1) are both exported so future surfaces
/// (milestone visuals, dashboard widgets) can reuse them without
/// re-wiring Prisma. Scheduler is a plain provider — @Cron is picked up
/// via ScheduleModule.forRoot() in AppModule.
@Module({
  controllers: [LifeController],
  providers: [LifeService, LifeWeekService, LifeScheduler],
  exports: [LifeService, LifeWeekService],
})
export class LifeModule {}
