import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { ActivityModule } from './activity/activity.module';
import { SectionsModule } from './sections/sections.module';
import { TasksModule } from './tasks/tasks.module';
import { FocusSessionsModule } from './focus-sessions/focus-sessions.module';
import { LifeModule } from './life/life.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    AuthModule,
    DevicesModule,
    TelemetryModule,
    ActivityModule,
    SectionsModule,
    TasksModule,
    FocusSessionsModule,
    LifeModule,
    HealthModule,
  ],
})
export class AppModule {}
