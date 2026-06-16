import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { PasswordService } from '../auth/password.service';
import { SeedUserCommand, PasswordPromptQuestions } from './seed-user.command';
import { ResetPasswordCommand } from './reset-password.command';
import { ListUsersCommand } from './list-users.command';

/// CLI runtime module. Loaded by `cli/main.ts` via CommandFactory.
/// Deliberately does NOT import AuthModule (no need for JwtModule / JWT_SECRET
/// in CLI contexts — none of the commands mint tokens).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    PrismaModule,
    UsersModule,
  ],
  providers: [
    PasswordService,
    SeedUserCommand,
    ResetPasswordCommand,
    ListUsersCommand,
    PasswordPromptQuestions,
  ],
})
export class CliModule {}
