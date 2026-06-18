import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  telemetryBatchSchema,
  type TelemetryBatch,
  type TelemetryBatchResponse,
} from '@focus-tracker/shared';
import { ApiKeyAuthGuard, type ApiKeyRequestContext } from '../auth/api-key-auth.guard';
import { CurrentApiClient } from '../common/decorators/current-api-client.decorator';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { TelemetryService } from './telemetry.service';

/// Single ingest endpoint for source clients (browser extension + desktop
/// daemon). Auth is API-key only (`ft_live_*`); JWTs are rejected by the
/// guard with `token_wrong_type`. See Auth.md §5 + PROJECT.md §7.2.
@Controller('telemetry')
@UseGuards(ApiKeyAuthGuard)
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post('batch')
  @HttpCode(200)
  async ingestBatch(
    @CurrentApiClient() client: ApiKeyRequestContext,
    @Body(new ZodBodyPipe(telemetryBatchSchema)) batch: TelemetryBatch,
  ): Promise<TelemetryBatchResponse> {
    return this.telemetry.ingest(client, batch);
  }
}
