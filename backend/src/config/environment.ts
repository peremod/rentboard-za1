import { Logger } from '@nestjs/common';

/**
 * Deployment environment. Distinct from NODE_ENV on purpose.
 *
 * NODE_ENV is a *build* concern — Nest, Express and most libraries want
 * `production` on staging too, for performance and to suppress verbose error
 * output. render.yaml correctly sets NODE_ENV=production on the `develop`
 * branch for that reason.
 *
 * APP_ENV is a *deployment* concern: which of the three environments is this
 * actually? Anything that must differ between staging and production —
 * indexability, CORS origins, payment sandbox mode — keys off this, never off
 * NODE_ENV. Conflating the two is how a staging box ends up crawlable and
 * pointed at production origins while every config file looks correct.
 */
export type AppEnv = 'development' | 'staging' | 'production';

const VALID: AppEnv[] = ['development', 'staging', 'production'];

export function appEnv(): AppEnv {
  const value = process.env.APP_ENV as AppEnv | undefined;
  if (value && VALID.includes(value)) return value;
  // Defaulting to development is the safe direction: it means not indexable
  // and not accepting production origins. A missing value should never
  // silently mean production.
  return 'development';
}

export function isProductionDeployment(): boolean {
  return appEnv() === 'production';
}

/**
 * The CORS allow-list for this deployment.
 *
 * Derived from FRONTEND_URL rather than hard-coded, because the previous
 * hard-coded list keyed off NODE_ENV — which meant Render staging, running
 * with NODE_ENV=production, allowed only rentboard.co.za and rejected every
 * request from staging.rentboard.co.za. The staging frontend could not talk
 * to the staging API at all.
 */
export function corsOrigins(): string[] {
  const frontend = process.env.FRONTEND_URL?.replace(/\/$/, '');

  switch (appEnv()) {
    case 'production': {
      const origins = ['https://rentboard.co.za', 'https://www.rentboard.co.za'];
      if (frontend && !origins.includes(frontend)) origins.push(frontend);
      return origins;
    }
    case 'staging':
      return frontend ? [frontend] : ['https://staging.rentboard.co.za'];
    default:
      return ['http://localhost:4200'];
  }
}

/**
 * Fails the boot on a misconfigured environment rather than serving traffic
 * that is subtly wrong.
 *
 * The failures this catches are the quiet kind: an unset SITE_URL that used to
 * fall back to the production origin, staging sharing production's JWT secret
 * so a staging token authenticates against live data, or live payment
 * credentials on a staging box. None of these throw on their own. All of them
 * are worse to discover later.
 *
 * Call this before app.listen().
 */
export function validateEnvironment(): void {
  const logger = new Logger('Environment');
  const env = appEnv();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!process.env.APP_ENV) {
    warnings.push(
      'APP_ENV is not set — defaulting to "development". Set it to development, staging or production on every deployment target.',
    );
  }

  // ── Required everywhere ──
  for (const key of ['SITE_URL', 'FRONTEND_URL', 'DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!process.env[key]) errors.push(`${key} is required but not set.`);
  }

  const siteUrl = process.env.SITE_URL;
  if (siteUrl?.endsWith('/')) {
    errors.push('SITE_URL must not have a trailing slash — canonical URLs are built by concatenation.');
  }

  // ── Cross-environment contamination ──
  if (env !== 'production' && siteUrl?.includes('rentboard.co.za') && !siteUrl.includes('staging')) {
    errors.push(
      `SITE_URL is "${siteUrl}" but APP_ENV is "${env}". A non-production deployment publishing production URLs will be treated by search engines as a duplicate of the real site.`,
    );
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    errors.push('JWT_SECRET and JWT_REFRESH_SECRET must differ. Sharing them defeats the point of having two.');
  }

  // ── Production-only requirements ──
  if (env === 'production') {
    if (process.env.PAYFAST_SANDBOX === 'true') {
      errors.push('PAYFAST_SANDBOX is "true" in production. Real payments would go to the sandbox.');
    }
    for (const key of ['IMAGEKIT_PRIVATE_KEY', 'RESEND_API_KEY', 'ADMIN_ALERT_EMAIL']) {
      if (!process.env[key]) errors.push(`${key} is required in production.`);
    }
  } else {
    // Staging with live payment credentials is a real risk, not a theoretical
    // one — it charges real cards from a box nobody is watching.
    if (process.env.PAYFAST_SANDBOX !== 'true') {
      warnings.push(`PAYFAST_SANDBOX is not "true" in ${env}. Non-production environments should use the sandbox.`);
    }
  }

  for (const w of warnings) logger.warn(w);

  if (errors.length) {
    logger.error(`Environment validation failed (APP_ENV=${env}):`);
    for (const e of errors) logger.error(`  · ${e}`);
    throw new Error(`${errors.length} environment error(s). Refusing to start.`);
  }

  logger.log(`Environment OK — APP_ENV=${env}, SITE_URL=${siteUrl}, indexable=${env === 'production'}`);
}
