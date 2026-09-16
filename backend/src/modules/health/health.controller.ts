import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /health — used by Render's healthCheckPath (see render.yaml), the
 * verify-deployment workflow, uptime monitors, and Docker HEALTHCHECK.
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
      // NOTE: npm_package_version is only set by `npm run` scripts — Docker's
      // `node dist/main` (see backend/Dockerfile) never sets it, so this
      // fallback is what actually shows in production. Keep it in sync with
      // package.json manually until this reads package.json directly instead.
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    };
  }
}
