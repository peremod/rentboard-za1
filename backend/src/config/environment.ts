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
 * with NODE_ENV=production, allowed only umastande.co.za and rejected every
 * request from staging.umastande.co.za. The staging frontend could not talk
 * to the staging API at all.
 */
export function corsOrigins(): string[] {
  const frontend = process.env.FRONTEND_URL?.replace(/\/$/, '');

  switch (appEnv()) {
    case 'production': {
      const origins = ['https://umastande.co.za', 'https://www.umastande.co.za'];
      if (frontend && !origins.includes(frontend)) origins.push(frontend);
      return origins;
    }
    case 'staging':
      return frontend ? [frontend] : ['https://staging.umastande.co.za'];
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
  // JWT_REFRESH_SECRET is deliberately NOT here. Refresh tokens are random
  // strings stored as SHA-256 hashes in the refresh_tokens table, not signed
  // JWTs, so there is no secret to set. Requiring it stopped the app booting
  // for a variable nothing reads.
  for (const key of ['SITE_URL', 'FRONTEND_URL', 'DATABASE_URL', 'JWT_SECRET']) {
    if (!process.env[key]) errors.push(`${key} is required but not set.`);
  }

  const siteUrl = process.env.SITE_URL;
  if (siteUrl?.endsWith('/')) {
    errors.push('SITE_URL must not have a trailing slash — canonical URLs are built by concatenation.');
  }

  // ── Cross-environment contamination ──
  if (env !== 'production' && siteUrl?.includes('umastande.co.za') && !siteUrl.includes('staging')) {
    errors.push(
      `SITE_URL is "${siteUrl}" but APP_ENV is "${env}". A non-production deployment publishing production URLs will be treated by search engines as a duplicate of the real site.`,
    );
  }

  // ── Production-only requirements ──
  if (env === 'production') {
    if (process.env.PAYFAST_SANDBOX === 'true') {
      errors.push('PAYFAST_SANDBOX is "true" in production. Real payments would go to the sandbox.');
    }
    // RESEND_WEBHOOK_SECRET is on this list because the webhook handler fails
    // closed without it: bounces and complaints would stop being recorded, and
    // the sending domain's reputation degrades silently. Failing the boot is
    // the visible version of that.
    for (const key of ['IMAGEKIT_PRIVATE_KEY', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'ADMIN_ALERT_EMAIL']) {
      if (!process.env[key]) errors.push(`${key} is required in production.`);
    }

    /**
     * API_URL is the origin PayFast posts its payment notification to.
     *
     * Unset or wrong, nothing fails visibly and nothing logs: the landlord is
     * charged R149, PayFast POSTs the ITN to whatever this says, and the
     * payment is never marked paid. The person has paid and the product
     * believes they have not. There is no error to see, because from this
     * server's point of view nothing happened at all.
     */
    if (!process.env.API_URL) {
      errors.push('API_URL is required in production — PayFast posts its payment notification to it.');
    }

    /**
     * A value that is set but meaningless passes every "is it set" check ever
     * written, and this validator was one of them: API_URL was
     * `https://example.com` on the live deployment while three other checks
     * above reported the environment as incomplete for entirely different
     * reasons.
     */
    const PLACEHOLDER = /example\.(com|org|net)|localhost|127\.0\.0\.1|changeme|your-domain|yourdomain/i;
    for (const key of ['SITE_URL', 'FRONTEND_URL', 'API_URL']) {
      const value = process.env[key];
      if (value && PLACEHOLDER.test(value)) {
        errors.push(`${key} is "${value}" in production — that is a placeholder, not a deployment.`);
      }
    }

    /**
     * Warned rather than failed, because a cutover can legitimately run with
     * these apart for a while. But every link in every email, the WhatsApp
     * listing bot's claim URL, the reference request a previous landlord
     * clicks, and PayFast's return and cancel URLs are all built from
     * FRONTEND_URL — so while they differ, real people are being sent
     * somewhere other than the site the canonical names.
     */
    const frontendOrigin = process.env.FRONTEND_URL?.replace(/\/$/, '');
    const siteOrigin = siteUrl?.replace(/\/$/, '');
    if (frontendOrigin && siteOrigin && frontendOrigin !== siteOrigin) {
      warnings.push(
        `FRONTEND_URL (${frontendOrigin}) and SITE_URL (${siteOrigin}) differ in production. Email links, the WhatsApp claim URL and PayFast's return URL are all built from FRONTEND_URL.`,
      );
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
