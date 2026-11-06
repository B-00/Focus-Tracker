import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  focusSessionListQuerySchema,
  startFocusSessionRequestSchema,
  type FocusSessionCurrentResponse,
  type FocusSessionListQuery,
  type FocusSessionListResponse,
  type FocusSessionResponse,
  type StartFocusSessionRequest,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { FocusSessionsService } from './focus-sessions.service';

/// Focus-session surface (FocusSession.md §10). JWT-guarded at the class
/// level — every endpoint is user-scoped.
///
/// Route map:
///   GET  /v1/focus-sessions/current       — poll hot path (5s)
///   GET  /v1/focus-sessions?from&to&limit — history list
///   GET  /v1/focus-sessions/:id           — detail (used by summary view)
///   POST /v1/focus-sessions               — start (409 w/ body when active)
///   POST /v1/focus-sessions/:id/pause
///   POST /v1/focus-sessions/:id/resume
///   POST /v1/focus-sessions/:id/stop
///
/// Literal routes (/current) are declared BEFORE :id to beat Nest's
/// param-route fallback.
@Controller('focus-sessions')
@UseGuards(JwtAuthGuard)
export class FocusSessionsController {
  constructor(private readonly sessions: FocusSessionsService) {}

  @Get('current')
  getCurrent(
    @CurrentUser() user: JwtRequestContext,
  ): Promise<FocusSessionCurrentResponse> {
    return this.sessions.getCurrent(user.userId);
  }

  @Get()
  list(
    @CurrentUser() user: JwtRequestContext,
    @Query() rawQuery: Record<string, string>,
  ): Promise<FocusSessionListResponse> {
    const query: FocusSessionListQuery = focusSessionListQuerySchema.parse(rawQuery);
    return this.sessions.list(user.userId, query);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<FocusSessionResponse> {
    return this.sessions.getById(user.userId, id);
  }

  @Post()
  start(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(startFocusSessionRequestSchema))
    body: StartFocusSessionRequest,
  ): Promise<FocusSessionResponse> {
    return this.sessions.start(user.userId, body);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<FocusSessionResponse> {
    return this.sessions.pause(user.userId, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<FocusSessionResponse> {
    return this.sessions.resume(user.userId, id);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<FocusSessionResponse> {
    return this.sessions.stop(user.userId, id);
  }
}
