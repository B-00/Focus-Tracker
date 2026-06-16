import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  changePasswordRequestSchema,
  type ChangePasswordRequest,
} from '@focus-tracker/shared';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtRequestContext } from '../auth/token.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';

/// Routes under `/v1/me/*` — the authenticated-user self-service surface.
/// JWT-guarded at the class level so every route here is implicitly auth'd.
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

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
