import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';
import { BacklogController } from './backlog.controller';
import { MaintenanceService } from './maintenance.service';

/// Owns `/v1/tasks/*`, `/v1/instances/*`, and `/v1/backlog`. See `Tasks.md`.
///
/// All controllers live in one module because they operate on the same
/// aggregate (Task + its TaskInstances + its backlog view). The
/// MaintenanceService is exported so the CLI command can drive the
/// nightly job without re-wiring Prisma.
@Module({
  controllers: [TasksController, InstancesController, BacklogController],
  providers: [TasksService, InstancesService, MaintenanceService],
  exports: [TasksService, InstancesService, MaintenanceService],
})
export class TasksModule {}
