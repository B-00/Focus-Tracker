import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokens } from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// JWT access-token claims (Auth.md §4.3).
export interface AccessTokenPayload {
  sub: string; // user id
  scope: 'user';
  jti: string; // random; for tracing, not revocation
}

/// Verified subset attached to `req.user` by JwtAuthGuard.
export interface JwtRequestContext {
  userId: string;
  scope: 'user';
  jti: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  //  Access JWTs (Auth.md §4.3) — stateless, signature + exp only
  // -------------------------------------------------------------------------

  signAccessToken(userId: string): { token: string; expiresAt: Date } {
    const ttlSec = this.parseDuration(this.config.get<string>('JWT_ACCESS_TTL') ?? '15m');
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      scope: 'user',
      jti: randomBytes(16).toString('hex'),
    };
    const token = this.jwt.sign(payload, { expiresIn: ttlSec });
    return { token, expiresAt };
  }

  /// Verifies signature + `exp`. Throws UnauthorizedException with the
  /// appropriate error code on failure — JwtAuthGuard turns it into the wire
  /// response (Auth.md §3 / §4.3).
  verifyAccessToken(token: string): JwtRequestContext {
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'TokenExpiredError') {
        throw new UnauthorizedException({ error: 'token_expired' });
      }
      throw new UnauthorizedException({ error: 'token_invalid' });
    }

    if (payload?.scope !== 'user' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException({ error: 'token_invalid' });
    }

    return { userId: payload.sub, scope: payload.scope, jti: payload.jti };
  }

  // -------------------------------------------------------------------------
  //  Refresh tokens (Auth.md §4.4) — opaque, DB-backed, rotated per use
  // -------------------------------------------------------------------------

  /// Mints a fresh refresh token and persists its hash. Returns the raw
  /// token (caller must return it to the client — it can never be recovered
  /// from the DB afterwards).
  async issueRefreshToken(
    userId: string,
    metadata: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const ttlSec = this.parseDuration(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d');
    const raw = randomBytes(32).toString('base64url'); // ~43 chars
    const tokenHash = this.hashRefresh(raw);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: metadata.userAgent ?? null,
        ip: metadata.ip ?? null,
      },
    });

    return { token: raw, expiresAt };
  }

  /// Atomically rotates a refresh token: revoke the supplied one, issue a
  /// fresh one. Returns the new raw token. Throws UnauthorizedException
  /// `refresh_invalid` on every failure mode (not found / revoked / expired)
  /// — the response is intentionally undiscriminating per Auth.md §4.4.
  async rotateRefreshToken(
    rawToken: string,
    metadata: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<{ userId: string; refreshToken: string; refreshExpiresAt: Date }> {
    const tokenHash = this.hashRefresh(rawToken);

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { tokenHash } });
      const now = new Date();
      if (!row || row.revokedAt !== null || row.expiresAt <= now) {
        throw new UnauthorizedException({ error: 'refresh_invalid' });
      }

      await tx.refreshToken.update({
        where: { tokenHash },
        data: { revokedAt: now },
      });

      const ttlSec = this.parseDuration(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d');
      const newRaw = randomBytes(32).toString('base64url');
      const newHash = this.hashRefresh(newRaw);
      const newExpiresAt = new Date(Date.now() + ttlSec * 1000);

      await tx.refreshToken.create({
        data: {
          userId: row.userId,
          tokenHash: newHash,
          expiresAt: newExpiresAt,
          userAgent: metadata.userAgent ?? null,
          ip: metadata.ip ?? null,
        },
      });

      return { userId: row.userId, refreshToken: newRaw, refreshExpiresAt: newExpiresAt };
    });
  }

  /// Revoke a single refresh token by its raw value. Idempotent — no-op if
  /// the token doesn't exist or is already revoked.
  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashRefresh(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /// Revoke every active refresh token for a user. Optionally keep one
  /// specific token alive (used by `signOutOtherDevices` on password change
  /// — Auth.md §4.7 — so the device performing the change stays logged in).
  async revokeAllRefreshTokensForUser(
    userId: string,
    options: { exceptRawToken?: string } = {},
  ): Promise<{ revokedCount: number }> {
    const exceptHash = options.exceptRawToken
      ? this.hashRefresh(options.exceptRawToken)
      : undefined;
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptHash ? { NOT: { tokenHash: exceptHash } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return { revokedCount: result.count };
  }

  // -------------------------------------------------------------------------
  //  Convenience: full token pair issuance
  // -------------------------------------------------------------------------

  /// Mint both halves for a fresh login. Pure issuance — no DB read of the
  /// user row (caller already has it).
  async issueTokenPair(
    userId: string,
    metadata: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<AuthTokens> {
    const access = this.signAccessToken(userId);
    const refresh = await this.issueRefreshToken(userId, metadata);
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessExpiresAt: access.expiresAt.toISOString(),
      refreshExpiresAt: refresh.expiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------------

  private hashRefresh(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /// Parse `"15m" | "30d" | "3600s" | "1h"` into seconds.
  /// Conservative — only the units the spec uses are recognised.
  private parseDuration(value: string): number {
    const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
    if (!m) {
      throw new Error(
        `Invalid duration "${value}". Expected formats like "15m", "30d", "1h", "3600s".`,
      );
    }
    const amount = Number(m[1]);
    const unit = m[2] ?? 's';
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return amount * (multipliers[unit] ?? 1);
  }
}
