import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
///
/// ponytail: per-section + inbox dated endpoints were removed when
/// `/tasks` shipped with globals-only charts (no per-section UI). The
/// `dated_section_daily_score` table + its nightly writer are still in
/// place so this is a UI-layer deletion only; reinstating the endpoint
/// would be a one-file add if per-section charts come back.
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

}
