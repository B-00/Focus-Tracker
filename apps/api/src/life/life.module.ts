import { Module } from '@nestjs/common';
import { LifeController } from './life.controller';
import { LifeScheduler } from './life.scheduler';
import { LifeService } from './life.service';

/// Owns `/v1/life/*` + the week_activity_minutes maintenance job
/// (MementoMori.md §6).
///
/// LifeService is exported so future surfaces (per-week drawer, milestone
/// visuals) can re-use it without re-wiring Prisma. Scheduler is a plain
/// provider — @Cron is picked up via ScheduleModule.forRoot() in AppModule.
@Module({
  controllers: [LifeController],
  providers: [LifeService, LifeScheduler],
  exports: [LifeService],
})
export class LifeModule {}
