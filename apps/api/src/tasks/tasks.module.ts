import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';
import { BacklogController } from './backlog.controller';
import { ChartsController } from './charts.controller';
import { ChartsService } from './charts.service';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceScheduler } from './maintenance.scheduler';
import { VacationsController } from './vacations.controller';

/// Owns `/v1/tasks/*`, `/v1/instances/*`, `/v1/backlog`, and `/v1/charts/*`.
/// See `Tasks.md` + `TaskCharts.md`.
///
/// All controllers live in one module because they operate on the same
/// aggregate (Task + its TaskInstances + its backlog view + its score
/// snapshots). MaintenanceService is exported so the CLI command can
/// drive the nightly job without re-wiring Prisma. MaintenanceScheduler
/// is registered as a provider (no explicit export needed) — Nest picks
/// up its @Cron decorators automatically via ScheduleModule.forRoot()
/// in AppModule.
@Module({
  controllers: [
    TasksController,
    InstancesController,
    BacklogController,
    ChartsController,
    VacationsController,
  ],
  providers: [
    TasksService,
    InstancesService,
    ChartsService,
    MaintenanceService,
    MaintenanceScheduler,
  ],
  exports: [TasksService, InstancesService, MaintenanceService],
})
export class TasksModule {}
