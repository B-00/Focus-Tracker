import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type {
  ActivityRecentResponse,
  ActivitySummaryResponse,
} from '@focus-tracker/shared';
import {
  activityRecentQuerySchema,
  activitySummaryQuerySchema,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { ActivityService } from './activity.service';

/// Routes under `/v1/activity/*`. JWT-only — these power the web app's
/// `/activity` page and the dashboard widget. Source clients never read
/// from this surface; they only write via `POST /v1/telemetry/batch`.
///
/// Owner: Activity.md §6 (API surface).
@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /// Top-line totals + top-N apps/sites + breakdown chart data for the
  /// selected range. `range` defaults to "today" when omitted so the
  /// dashboard widget can hit this with no params.
  @Get('summary')
  summary(
    @CurrentUser() user: JwtRequestContext,
    @Query(new ZodBodyPipe(activitySummaryQuerySchema))
    query: { range: 'today' | 'yesterday' | '7d' | '30d' },
  ): Promise<ActivitySummaryResponse> {
    return this.activity.summary(user.userId, query.range);
  }

  /// Most-recent raw events for the "Recent switches" feed. Reverse-chrono,
  /// capped by `limit` (default 30, max 100).
  @Get('recent')
  recent(
    @CurrentUser() user: JwtRequestContext,
    @Query(new ZodBodyPipe(activityRecentQuerySchema))
    query: { limit: number },
  ): Promise<ActivityRecentResponse> {
    return this.activity.recent(user.userId, query.limit);
  }
}
