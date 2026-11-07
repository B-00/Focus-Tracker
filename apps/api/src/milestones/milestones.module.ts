import { Module } from '@nestjs/common';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

/// Owns `/v1/milestones` (MementoMori.md §7).
/// Exports MilestonesService so Life surfaces can reuse the read path
/// if they ever need to compose milestones into another response.
@Module({
  controllers: [MilestonesController],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
