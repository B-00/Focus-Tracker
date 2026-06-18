import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/// Owns:
///   - GET /v1/activity/summary?range=...     → ActivityController (JWT)
///   - GET /v1/activity/recent?limit=...      → ActivityController (JWT)
///
/// Reads `ActivityMinuteRollup` (populated by TelemetryModule on every
/// ingest batch) and `TelemetryEvent` (raw events for the recent feed).
/// No write side — the source clients are the only telemetry writers.
@Module({
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
