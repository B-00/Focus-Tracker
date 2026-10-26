import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';

/// Owns `/v1/tasks/*` and `/v1/instances/*`. See `Tasks.md`.
///
/// Both controllers live in one module because they operate on the
/// same aggregate (Task + its TaskInstances) and nightly maintenance
/// (Slice 3+) will coordinate them.
@Module({
  controllers: [TasksController, InstancesController],
  providers: [TasksService, InstancesService],
  exports: [TasksService, InstancesService],
})
export class TasksModule {}
