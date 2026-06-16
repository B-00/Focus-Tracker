import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  type AuthTokens,
  type LoginRequest,
  type LoginResponse,
  type LogoutRequest,
  type RefreshRequest,
} from '@focus-tracker/shared';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService, type RequestMetadata } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtRequestContext } from './token.service';

/// Routes under `/v1/auth/*`. The /v1 prefix is set globally in main.ts.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ------------------------------------------------------------------
  //  POST /v1/auth/login  (Auth.md §4.1)
  // ------------------------------------------------------------------
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body(new ZodBodyPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    return this.auth.login(body, this.metaFrom(req));
  }

  // ------------------------------------------------------------------
  //  POST /v1/auth/refresh  (Auth.md §4.5)
  // ------------------------------------------------------------------
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodBodyPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() req: Request,
  ): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken, this.metaFrom(req));
  }

  // ------------------------------------------------------------------
  //  POST /v1/auth/logout  (Auth.md §4.6)
  // ------------------------------------------------------------------
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Body(new ZodBodyPipe(logoutRequestSchema)) body: LogoutRequest,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  // ------------------------------------------------------------------
  //  POST /v1/auth/logout-all  (Auth.md §4.6)
  // ------------------------------------------------------------------
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser() user: JwtRequestContext): Promise<void> {
    await this.auth.logoutAll(user.userId);
  }

  // ------------------------------------------------------------------
  //  Helpers
  // ------------------------------------------------------------------
  private metaFrom(req: Request): RequestMetadata {
    return {
      userAgent: req.headers['user-agent'] ?? null,
      // Express's `req.ip` respects `app.set('trust proxy', ...)`; we don't
      // set it in v1 (single-machine localhost), so this is the direct peer.
      ip: req.ip ?? null,
    };
  }
}
