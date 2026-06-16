import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// GET /v1/health
/// Liveness + readiness probe. Returns 200 only if Postgres is reachable.
/// Owner: PROJECT.md §7.7.
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        error: 'database_unreachable',
        message: 'API is up but cannot reach Postgres.',
      });
    }

    return {
      status: 'ok',
      apiVersion: process.env.npm_package_version ?? '0.0.1',
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      now: new Date().toISOString(),
    };
  }
}
