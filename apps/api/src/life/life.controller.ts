import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  lifeWeekNoteUpsertSchema,
  type LifeGridResponse,
  type LifeWeekDetail,
  type LifeWeekNote,
  type LifeWeekNoteUpsert,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { LifeService } from './life.service';
import { LifeWeekService } from './life-week.service';

/// Memento Mori life-grid surface (MementoMori.md §7).
///
/// Route map:
///   GET /v1/life/grid                   — single-request render of the whole grid
///   GET /v1/life/weeks/:weekIndex       — per-week drawer payload (§5.1 / §5.2)
///   PUT /v1/life/weeks/:weekIndex/note  — upsert the WeekNote (§5.1)
///
/// JWT-guarded at the class level.
@Controller('life')
@UseGuards(JwtAuthGuard)
export class LifeController {
  constructor(
    private readonly life: LifeService,
    private readonly lifeWeek: LifeWeekService,
  ) {}

  @Get('grid')
  getGrid(@CurrentUser() user: JwtRequestContext): Promise<LifeGridResponse> {
    return this.life.getGrid(user.userId);
  }

  @Get('weeks/:weekIndex')
  getWeek(
    @CurrentUser() user: JwtRequestContext,
    @Param('weekIndex', ParseIntPipe) weekIndex: number,
  ): Promise<LifeWeekDetail> {
    return this.lifeWeek.getWeek(user.userId, weekIndex);
  }

  @Put('weeks/:weekIndex/note')
  upsertNote(
    @CurrentUser() user: JwtRequestContext,
    @Param('weekIndex', ParseIntPipe) weekIndex: number,
    @Body(new ZodBodyPipe(lifeWeekNoteUpsertSchema))
    body: LifeWeekNoteUpsert,
  ): Promise<LifeWeekNote | null> {
    return this.lifeWeek.upsertNote(user.userId, weekIndex, body.body);
  }
}
