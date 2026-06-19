import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  changePasswordRequestSchema,
  updateMeProfileRequestSchema,
  type ChangePasswordRequest,
  type MeProfileResponse,
  type UpdateMeProfileRequest,
} from '@focus-tracker/shared';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtRequestContext } from '../auth/token.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { UsersService } from './users.service';

/// Routes under `/v1/me/*` — the authenticated-user self-service surface.
/// JWT-guarded at the class level so every route here is implicitly auth'd.
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  /// GET /v1/me/profile  (Settings.md §6.3)
  ///
  /// Returns the full profile projection so the web app can detect a stale
  /// or default timezone and trigger the auto-detect backfill (§4.1.1).
  @Get('profile')
  getProfile(@CurrentUser() user: JwtRequestContext): Promise<MeProfileResponse> {
    return this.users.getProfile(user.userId);
  }

  /// PATCH /v1/me/profile  (Settings.md §6.3)
  ///
  /// Partial update. `autoDetect: true` is the silent-backfill flow used by
  /// the web app on boot; everything else is a manual edit from the Settings
  /// UI (when it lands).
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(updateMeProfileRequestSchema)) body: UpdateMeProfileRequest,
  ): Promise<MeProfileResponse> {
    return this.users.updateProfile(user.userId, body);
  }

  /// POST /v1/me/password  (Auth.md §4.7)
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.auth.changePassword(user.userId, body);
  }
}
