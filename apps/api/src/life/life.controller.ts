import { Controller, Get, UseGuards } from '@nestjs/common';
import type { LifeGridResponse } from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { LifeService } from './life.service';

/// Memento Mori life-grid surface (MementoMori.md §7).
///
/// Route map:
///   GET /v1/life/grid — single-request render of the whole grid
///
/// JWT-guarded at the class level.
@Controller('life')
@UseGuards(JwtAuthGuard)
export class LifeController {
  constructor(private readonly life: LifeService) {}

  @Get('grid')
  getGrid(@CurrentUser() user: JwtRequestContext): Promise<LifeGridResponse> {
    return this.life.getGrid(user.userId);
  }
}
