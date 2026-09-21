import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Read once at startup, from package.json rather than a hand-maintained
 * constant.
 *
 * `npm_package_version` is only set when the process is started by an npm
 * script, and production runs `node dist/main` (see backend/Dockerfile), so
 * it is never set where it matters. The old fallback was a literal that a
 * comment asked people to keep in sync by hand — it said 1.0.0 while the
 * repository was on v1.54.0, so /health reported a version four dozen
 * releases stale, which is worth knowing during an incident and misleading
 * at exactly the wrong moment.
 *
 * `__dirname` is dist/modules/health at runtime, and the Dockerfile copies
 * package.json to /app alongside dist/, so this path resolves in the image
 * and locally. If it ever does not, an unknown version is better than a
 * confident wrong one — and better than a health check that throws.
 */
const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

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
      version: VERSION,
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    };
  }
}
