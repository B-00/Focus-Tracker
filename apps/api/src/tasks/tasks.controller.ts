import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createTaskRequestSchema,
  listTasksQuerySchema,
  updateTaskRequestSchema,
  type CreateTaskRequest,
  type ListTasksQuery,
  type TaskResponse,
  type UpdateTaskRequest,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { TasksService } from './tasks.service';

/// Routes under `/v1/tasks/*`. JWT-only — user data.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @CurrentUser() user: JwtRequestContext,
    @Query() rawQuery: Record<string, string>,
  ): Promise<TaskResponse[]> {
    // Query strings are stringly-typed on the wire — Zod has `coerce`
    // helpers but for a 4-field query the explicit parse is clearer.
    const query: ListTasksQuery = listTasksQuerySchema.parse(rawQuery);
    return this.tasks.list(user.userId, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<TaskResponse> {
    return this.tasks.getById(user.userId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(createTaskRequestSchema)) body: CreateTaskRequest,
  ): Promise<TaskResponse> {
    return this.tasks.create(user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateTaskRequestSchema)) body: UpdateTaskRequest,
  ): Promise<TaskResponse> {
    return this.tasks.update(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.tasks.remove(user.userId, id);
  }
}
