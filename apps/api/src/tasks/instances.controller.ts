import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  updateInstanceRequestSchema,
  type TaskInstanceResponse,
  type UpdateInstanceRequest,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { InstancesService } from './instances.service';

/// Routes under `/v1/instances/*`. JWT-only; owned via Task.userId.
///
/// `GET /today` is the heartbeat of the Routine panel: it lazy-creates
/// today's instances on first read and returns them. The web layer
/// calls this once per /tasks visit and treats the response as the
/// source of truth for today's checkbox state.
@Controller('instances')
@UseGuards(JwtAuthGuard)
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  @Get('today')
  listToday(
    @CurrentUser() user: JwtRequestContext,
  ): Promise<TaskInstanceResponse[]> {
    return this.instances.listToday(user.userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateInstanceRequestSchema)) body: UpdateInstanceRequest,
  ): Promise<TaskInstanceResponse> {
    return this.instances.update(user.userId, id, body);
  }
}
