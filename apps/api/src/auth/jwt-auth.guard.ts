import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService, type JwtRequestContext } from './token.service';

/// Express request augmented with the JWT-resolved user context.
export type AuthenticatedRequest = Request & { user?: JwtRequestContext };

/// Verifies an access JWT from the `Authorization: Bearer <token>` header
/// and attaches `{ userId, scope, jti }` to `req.user`. Apply per-controller
/// or per-route via `@UseGuards(JwtAuthGuard)`.
///
/// Rejects `ft_live_*` tokens with `token_wrong_type` so source clients get
/// a clear signal that they hit a route meant for the web app
/// (Auth.md §3 / §5.4).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = this.extractBearer(req);
    if (!raw) {
      throw new UnauthorizedException({ error: 'token_invalid' });
    }
    if (raw.startsWith('ft_live_')) {
      throw new UnauthorizedException({ error: 'token_wrong_type' });
    }

    req.user = this.tokens.verifyAccessToken(raw);
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? (match[1] ?? null) : null;
  }
}
