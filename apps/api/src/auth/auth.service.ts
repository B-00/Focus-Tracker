import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AuthTokens,
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
} from '@focus-tracker/shared';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/// HTTP-shaped metadata captured at the controller and forwarded into
/// AuthService so RefreshToken rows record where they originated.
export interface RequestMetadata {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  // -------------------------------------------------------------------------
  //  POST /v1/auth/login  (Auth.md §4.1)
  // -------------------------------------------------------------------------

  async login(input: LoginRequest, metadata: RequestMetadata): Promise<LoginResponse> {
    const user = await this.users.findByEmail(input.email);

    if (!user) {
      // Dev-only escape hatch: if the DB has no users at all, return 503
      // with a hint instead of the generic 401. Auth.md §6.2.
      if (process.env.NODE_ENV !== 'production' && !(await this.users.hasAnyUser())) {
        throw new ServiceUnavailableException({
          error: 'no_user_seeded',
          hint:
            'No user account exists yet. Run on the server: ' +
            '`pnpm --filter @focus-tracker/api seed-user --email <your-email>`',
        });
      }
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }

    // Transparent re-hash if params changed since this hash was written.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const newHash = await this.passwords.hash(input.password);
      await this.users.updatePasswordHash(user.id, newHash);
    }

    const tokens = await this.tokens.issueTokenPair(user.id, metadata);
    return {
      ...tokens,
      user: this.projectUser(user),
    };
  }

  // -------------------------------------------------------------------------
  //  POST /v1/auth/refresh  (Auth.md §4.5)
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string, metadata: RequestMetadata): Promise<AuthTokens> {
    const rotated = await this.tokens.rotateRefreshToken(refreshToken, metadata);
    const access = this.tokens.signAccessToken(rotated.userId);
    return {
      accessToken: access.token,
      refreshToken: rotated.refreshToken,
      accessExpiresAt: access.expiresAt.toISOString(),
      refreshExpiresAt: rotated.refreshExpiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  //  POST /v1/auth/logout  (Auth.md §4.6)
  // -------------------------------------------------------------------------

  /// Revokes the supplied refresh token. Idempotent. The supplied token does
  /// NOT have to belong to the currently-authenticated user — but the route
  /// is JWT-guarded so a random caller can't churn through every token.
  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(refreshToken);
  }

  // -------------------------------------------------------------------------
  //  POST /v1/auth/logout-all  (Auth.md §4.6)
  // -------------------------------------------------------------------------

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllRefreshTokensForUser(userId);
  }

  // -------------------------------------------------------------------------
  //  POST /v1/me/password  (Auth.md §4.7)
  // -------------------------------------------------------------------------

  async changePassword(userId: string, input: ChangePasswordRequest): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      // JWT was valid but the user row vanished. Treat the same as wrong
      // current password from the client's perspective.
      throw new UnauthorizedException({ error: 'current_password_wrong' });
    }

    const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new UnauthorizedException({ error: 'current_password_wrong' });
    }

    if (input.currentPassword === input.newPassword) {
      throw new HttpException(
        { error: 'weak_password', reason: 'New password must differ from current.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const newHash = await this.passwords.hash(input.newPassword);
    await this.users.updatePasswordHash(userId, newHash);

    if (input.signOutOtherDevices) {
      await this.tokens.revokeAllRefreshTokensForUser(userId, {
        exceptRawToken: input.refreshToken,
      });
    }
  }

  // -------------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------------

  private projectUser(user: {
    id: string;
    email: string;
    displayName: string | null;
  }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }
}
