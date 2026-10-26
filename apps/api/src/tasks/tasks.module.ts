import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/// Owns `/v1/tasks/*`. See `Tasks.md`.
///
/// Slice 1: dated + ongoing kinds, full CRUD. Routines (Slice 2) and
/// transfer/backlog (Slice 3) extend this same module.
@Module({
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
