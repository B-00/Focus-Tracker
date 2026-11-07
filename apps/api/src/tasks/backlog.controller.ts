import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  backlogListQuerySchema,
  type BacklogListQuery,
  type BacklogListResponse,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { TasksService } from './tasks.service';

/// Routes under `/v1/backlog`. Separate controller from TasksController
/// because the backlog is a *view* over tasks with its own shape
/// (summary + list, not a flat task array) and its own query surface.
/// Co-locates in TasksModule so it shares TasksService.
@Controller('backlog')
@UseGuards(JwtAuthGuard)
export class BacklogController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @CurrentUser() user: JwtRequestContext,
    @Query() rawQuery: Record<string, string>,
  ): Promise<BacklogListResponse> {
    const query: BacklogListQuery = backlogListQuerySchema.parse(rawQuery);
    return this.tasks.listBacklog(user.userId, query);
  }
}
