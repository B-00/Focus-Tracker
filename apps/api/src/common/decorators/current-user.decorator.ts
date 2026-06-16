import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';
import type { JwtRequestContext } from '../../auth/token.service';

/// Convenience decorator: pulls the `req.user` populated by JwtAuthGuard.
/// Usage:
///
///   @UseGuards(JwtAuthGuard)
///   @Post('something')
///   handle(@CurrentUser() user: JwtRequestContext) { ... }
///
/// Throws if used on a route that isn't guarded by JwtAuthGuard (defensive
/// — surfaces wiring mistakes loudly rather than silently passing `undefined`).
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtRequestContext => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) {
      throw new Error(
        'CurrentUser used on a route without JwtAuthGuard — req.user is not populated.',
      );
    }
    return req.user;
  },
);
