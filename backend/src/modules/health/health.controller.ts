import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /health — used by Railway health checks, uptime monitors, and Docker HEALTHCHECK.
 * Excluded from the /api global prefix (see main.ts setGlobalPrefix exclude list).
 */
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async health() {
    const dbOk = await this.prisma.isHealthy();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'unavailable',
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    };
  }
}
