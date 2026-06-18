import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { MeController } from '../users/me.controller';

/// `@Global` so the JwtAuthGuard + AuthService + TokenService can be used
/// from any future module (Tasks, Telemetry, Devices, ...) without an
/// explicit re-import.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret === 'change-me-to-a-64-byte-hex-string') {
          throw new Error(
            'JWT_SECRET is missing or still set to the .env.example placeholder. ' +
              'Generate one with `openssl rand -hex 64` and set it in apps/api/.env.',
          );
        }
        return {
          secret,
          signOptions: { algorithm: 'HS256' },
        };
      },
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, TokenService, PasswordService, JwtAuthGuard, ApiKeyAuthGuard],
  exports: [
    AuthService,
    TokenService,
    PasswordService,
    JwtAuthGuard,
    ApiKeyAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
