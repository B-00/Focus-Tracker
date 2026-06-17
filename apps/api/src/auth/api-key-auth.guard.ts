import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ApiKeyScope } from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// Resolved context attached to `req.apiClient` after a successful API-key
/// auth. Deliberately separate from `req.user` (which JwtAuthGuard owns) so
/// the two contexts cannot collide on a single request.
export interface ApiKeyRequestContext {
  userId: string;
  deviceId: string;
  scope: ApiKeyScope;
}

export type ApiKeyAuthenticatedRequest = Request & {
  apiClient?: ApiKeyRequestContext;
};

/// Guards routes that accept a long-lived `ft_live_...` API key issued via
/// the pairing flow (Auth.md §5). The guard:
///
///   1. Pulls the Bearer token off the `Authorization` header
///   2. Rejects tokens without the `ft_live_` prefix with `token_wrong_type`
///      (mirrors JwtAuthGuard's reciprocal check)
///   3. Hashes the raw token (sha256) and looks up the matching `ApiKey`
///      row by hash
///   4. Rejects revoked keys with `api_key_revoked`
///   5. Attaches `{ userId, deviceId, scope }` to `req.apiClient`
///   6. Bumps `Device.lastSeen = now()` so Settings → Devices stays fresh
///      (per Auth.md §5.3 / Settings.md §4.4)
///
/// Scope enforcement (Auth.md §5.4): API keys are currently scoped
/// `telemetry_write`. There is only one route that uses this guard
/// (`POST /v1/telemetry/batch`), so the guard does NOT do path-based
/// scope checking — applying it to the wrong route is a configuration
/// error caught at startup. If/when more scopes land, gate per-route via
/// `@RequiredScope(...)` metadata + reflector.
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>();
    const raw = this.extractBearer(req);

    if (!raw) {
      throw new UnauthorizedException({ error: 'token_invalid' });
    }
    if (!raw.startsWith('ft_live_')) {
      // The most likely cause: someone hit the telemetry endpoint with their
      // JWT access token. Surface a clear "wrong token type" signal so the
      // client doesn't mistakenly hand its JWT to the API-key guard again.
      throw new UnauthorizedException({ error: 'token_wrong_type' });
    }

    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const row = await this.prisma.apiKey.findUnique({
      where: { tokenHash },
      select: { userId: true, deviceId: true, scope: true, revokedAt: true },
    });

    if (!row) {
      // We don't differentiate "no such key" from "wrong hash" — both are
      // `token_invalid`. (Revoked keys are distinct because the row still
      // exists and we want a clearer client signal.)
      throw new UnauthorizedException({ error: 'token_invalid' });
    }
    if (row.revokedAt !== null) {
      throw new ForbiddenException({ error: 'api_key_revoked' });
    }

    req.apiClient = {
      userId: row.userId,
      deviceId: row.deviceId,
      scope: row.scope as ApiKeyScope,
    };

    // Fire-and-forget lastSeen bump. We don't await because (a) it's
    // non-critical for the request's correctness and (b) doing it sync
    // would add a round-trip to every authenticated request. Errors are
    // swallowed for the same reason — a missed bump is a cosmetic issue.
    void this.prisma.device
      .update({
        where: { id: row.deviceId },
        data: { lastSeen: new Date() },
      })
      .catch(() => {});

    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? (match[1] ?? null) : null;
  }
}
