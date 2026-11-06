import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  chartRangeQuerySchema,
  type ChartRangeQuery,
  type DatedChartSeriesResponse,
  type RoutineChartSeriesResponse,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ChartsService } from './charts.service';

/// Consistency chart endpoints (TaskCharts.md §6.1 + §7):
///
///   GET /v1/charts/routine/global
///   GET /v1/charts/dated/global
///   GET /v1/charts/dated/sections/:id
///
/// Spec §7 lists the per-section path as
/// `/v1/sections/{id}/dated-stats` — kept together under /v1/charts here
/// so all chart surface routes live in one controller and the routing
/// matches the UI's mental model ("there's a /charts namespace").
/// This is a naming-only departure, documented so it doesn't drift from
/// the spec silently.
@Controller('charts')
@UseGuards(JwtAuthGuard)
export class ChartsController {
  constructor(private readonly charts: ChartsService) {}

  @Get('routine/global')
  async routineGlobal(
    @CurrentUser() user: JwtRequestContext,
    @Query() rawQuery: Record<string, string>,
  ): Promise<RoutineChartSeriesResponse> {
    const query: ChartRangeQuery = chartRangeQuerySchema.parse(rawQuery);
    const series = await this.charts.routineGlobal(user.userId, query);
    return { series };
  }

  @Get('dated/global')
  async datedGlobal(
    @CurrentUser() user: JwtRequestContext,
    @Query() rawQuery: Record<string, string>,
  ): Promise<DatedChartSeriesResponse> {
    const query: ChartRangeQuery = chartRangeQuerySchema.parse(rawQuery);
    const series = await this.charts.datedGlobal(user.userId, query);
    return { series };
  }

  @Get('dated/sections/:id')
  async datedPerSection(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<DatedChartSeriesResponse> {
    const query: ChartRangeQuery = chartRangeQuerySchema.parse(rawQuery);
    const series = await this.charts.datedPerSection(user.userId, id, query);
    return { series };
  }

  /// Inbox dated series — same shape as `/dated/sections/:id` but scoped to
  /// tasks with `sectionId = NULL` (Tasks.md §3.4). Separate endpoint rather
  /// than a sentinel id ("inbox") so the service-level ownership check
  /// doesn't need a special case, and the URL stays human-readable.
  @Get('dated/inbox')
  async datedInbox(
    @CurrentUser() user: JwtRequestContext,
    @Query() rawQuery: Record<string, string>,
  ): Promise<DatedChartSeriesResponse> {
    const query: ChartRangeQuery = chartRangeQuerySchema.parse(rawQuery);
    const series = await this.charts.datedPerSection(user.userId, null, query);
    return { series };
  }
}
