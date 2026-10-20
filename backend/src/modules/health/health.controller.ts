import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { appEnv } from '../../config/environment';

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
      /**
       * Which deployment this is, so a destructive tool can refuse before it
       * writes rather than after.
       *
       * scripts/smoke-test.sh registers landlords, creates and renames rooms,
       * and uploads placeholder photos. It carried the line "Never run it
       * against production" as a comment and nothing enforced it, so a
       * production board ended up showing "Wizard test studio in Rosebank
       * (updated)" and a landlord called "Renamed Landlord" to real visitors.
       * A comment is not a guard.
       *
       * Not sensitive: indexability, robots.txt and the CORS allow-list all
       * announce which environment this is already.
       */
      env: appEnv(),
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    };
  }

  /**
   * GET /health/live — liveness only. Deliberately does NOT touch the database.
   *
   * ⚠️ The distinction matters because of what pings this. `/health` above
   * calls `prisma.isHealthy()`, which is right for a READINESS check —
   * Render's healthCheckPath and the deploy verifier both want to know the
   * API can serve real traffic, and an API that cannot reach its database
   * cannot.
   *
   * But the keep-warm cron (.github/workflows/keep-warm.yml) runs every ten
   * minutes forever, and pointing that at `/health` would hold the NEON
   * COMPUTE open around the clock as a side effect of keeping the Render
   * web service awake — paying a second bill to solve the first. Those are
   * two different questions and they now have two different endpoints.
   *
   * No database, no filesystem, no version read: if the process is running
   * and the event loop is turning, this answers. That is exactly and only
   * what a wake-up ping needs to know.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'live', uptime: Math.floor(process.uptime()) };
  }
}
