import { Module } from '@nestjs/common';
import { FocusSessionsController } from './focus-sessions.controller';
import { FocusSessionsScheduler } from './focus-sessions.scheduler';
import { FocusSessionsService } from './focus-sessions.service';

/// Focus Session module (FocusSession.md).
///
/// Service is exported so future surfaces (summary breakdown, calendar
/// session indicators) can re-use the same lifecycle helpers without
/// re-importing Prisma.
@Module({
  controllers: [FocusSessionsController],
  providers: [FocusSessionsService, FocusSessionsScheduler],
  exports: [FocusSessionsService],
})
export class FocusSessionsModule {}
