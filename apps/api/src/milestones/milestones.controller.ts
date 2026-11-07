import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createMilestoneRequestSchema,
  updateMilestoneRequestSchema,
  type CreateMilestoneRequest,
  type Milestone,
  type UpdateMilestoneRequest,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { MilestonesService } from './milestones.service';

/// Milestones CRUD (MementoMori.md §7).
///
/// Route map:
///   GET    /v1/milestones       — list all for the authenticated user
///   POST   /v1/milestones       — create
///   PATCH  /v1/milestones/:id   — partial update
///   DELETE /v1/milestones/:id   — delete
///
/// JWT-guarded at the class level; the service enforces (userId, id)
/// ownership on every write.
@Controller('milestones')
@UseGuards(JwtAuthGuard)
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get()
  list(@CurrentUser() user: JwtRequestContext): Promise<Milestone[]> {
    return this.milestones.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(createMilestoneRequestSchema))
    body: CreateMilestoneRequest,
  ): Promise<Milestone> {
    return this.milestones.create(user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateMilestoneRequestSchema))
    body: UpdateMilestoneRequest,
  ): Promise<Milestone> {
    return this.milestones.update(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.milestones.delete(user.userId, id);
  }
}
