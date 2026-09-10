import { Controller, Get, Header, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Locales that carry a URL prefix. Mirrors PREFIXED_LOCALES in
 * frontend/src/app/core/models/language.model.ts — English is unprefixed.
 * Kept in sync by scripts/i18n-audit.mjs, which fails CI if they diverge.
 *
 * Only Afrikaans and isiZulu are here because only those two bundles are real
 * translations; the other eight are English-fallback stubs. Publishing a
 * locale URL that serves English is duplication, not localisation. Add a code
 * here in the same commit that lands its translation and flips
 * `translated: true` in the frontend model.
 */
const PREFIXED_LOCALES = ['af', 'zu'] as const;

/** hreflang tag per locale, English included. 'nso' has no ISO 639-1 form. */
const HREFLANG: Record<string, string> = {
  en: 'en-ZA', af: 'af-ZA', zu: 'zu-ZA', xh: 'xh-ZA', st: 'st-ZA', tn: 'tn-ZA',
  nso: 'nso-ZA', ts: 'ts-ZA', ss: 'ss-ZA', ve: 've-ZA', nr: 'nr-ZA',
};

/**
 * Technical SEO endpoints. Excluded from the /api prefix (see main.ts) so
 * they serve at the domain root where crawlers expect them.
 *
 * The sitemap is generated from live data — every active room is included,
 * and let/draft rooms are excluded so crawlers never index a dead listing.
 */
@Controller()
export class SeoController {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Read from config rather than hard-coded, so staging advertises its own
   * host. A staging sitemap listing production URLs tells Google that
   * staging duplicates production and invites it to pick a winner.
   *
   * There is deliberately no fallback to the production origin. An unset
   * SITE_URL used to silently mean "production", so a misconfigured staging
   * box would publish production URLs and look correct in every log. Failing
   * loudly at the first request is the cheaper failure.
   */
  private get site(): string {
    const url = this.config.get<string>('SITE_URL');
    if (!url) {
      throw new Error(
        'SITE_URL is not set. It is required on every deployment target and must ' +
          'be the public origin of the FRONTEND for this environment, with no ' +
          'trailing slash. See backend/.env.example.',
      );
    }
    return url.replace(/\/$/, '');
  }

  /**
   * Only production may be crawled. Anything else serves a blanket refusal.
   *
   * Gated on APP_ENV, not NODE_ENV, and the distinction is not academic.
   * NODE_ENV is a *build* concern: Nest and Express both want
   * NODE_ENV=production on staging too, for performance and to disable
   * verbose error output. render.yaml correctly sets NODE_ENV=production on
   * the `develop` branch for exactly that reason.
   *
   * Gating indexability on NODE_ENV therefore made Render staging fully
   * crawlable while looking correct in every config file. APP_ENV is a
   * *deployment* concern and is the only thing that decides this.
   */
  private get indexable(): boolean {
    return this.config.get<string>('APP_ENV') === 'production';
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain')
  @Header('Cache-Control', 'public, max-age=3600')
  robots(): string {
    if (!this.indexable) {
      // Staging and development: nothing at all. Belt and braces with the
      // X-Robots-Tag header set in vercel.json for the frontend host.
      return ['User-agent: *', 'Disallow: /'].join('\n');
    }

    return [
      'User-agent: *',
      'Allow: /',
      '',
      '# Private and authenticated areas — no SEO value, and must not be crawled.',
      'Disallow: /auth/',
      'Disallow: /tenant/',
      'Disallow: /landlord/',
      'Disallow: /account/',
      'Disallow: /admin/',
      'Disallow: /api/',
      '',
      '# Filter permutations on the board are near-duplicates of each other and',
      '# burn crawl budget that belongs to room pages.',
      'Disallow: /*?*province=',
      'Disallow: /*?*maxRent=',
      'Disallow: /*?*sort=',
      '',
      '# Tracking parameters must never fork a URL in the index.',
      'Disallow: /*?*utm_',
      '',
      '# Locale-prefixed private areas — the same rules apply in all 11 languages.',
      ...PREFIXED_LOCALES.flatMap((l) => [
        `Disallow: /${l}/auth/`,
        `Disallow: /${l}/tenant/`,
        `Disallow: /${l}/landlord/`,
        `Disallow: /${l}/account/`,
        `Disallow: /${l}/admin/`,
      ]),
      '',
      `Sitemap: ${this.site}/sitemap.xml`,
    ].join('\n');
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml')
  @Header('Cache-Control', 'public, s-maxage=3600')
  async sitemap(@Res() res: Response) {
    const rooms = await this.prisma.room.findMany({
      where: { status: 'active' },
      select: { id: true, updatedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 20000, // sitemap spec limit is 50k URLs / 50MB
    });

    /**
     * Every entry here must resolve to a real route with a 200. The previous
     * list included '/rooms', which had no route and fell through to the
     * not-found page — a soft 404 advertised to Google in our own sitemap.
     * (A '/rooms' → '/' redirect now exists in app.routes.ts as well, so old
     * inbound links land somewhere real.) The list also omitted
     * /how-it-works, /pricing and /advertise, which are prerendered,
     * keyword-relevant, and were simply never submitted.
     */
    const staticUrls = [
      { loc: '/', priority: '1.0', freq: 'daily' },
      { loc: '/how-it-works', priority: '0.8', freq: 'monthly' },
      { loc: '/pricing', priority: '0.8', freq: 'monthly' },
      { loc: '/advertise', priority: '0.5', freq: 'monthly' },
      { loc: '/legal/privacy', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/terms', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/disclaimer', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/cookies', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/paia', priority: '0.3', freq: 'yearly' },
    ];

    /**
     * Static pages exist in all eleven languages, so each is submitted once
     * per locale with a full reciprocal hreflang cluster attached.
     *
     * The cluster must be complete and self-referential on every URL in it —
     * a partial set is discarded silently by Google, which is the usual
     * reason hreflang "does nothing".
     *
     * Room pages are excluded from the cluster: a landlord's description is
     * never translated, so the localised URLs serve the same text. They are
     * submitted once, at their English canonical.
     */
    const localisedEntries = staticUrls.flatMap((u) =>
      ['en', ...PREFIXED_LOCALES].map((locale) => {
        const loc = `${this.site}${this.localise(u.loc, locale)}`;
        const alternates = [
          ...['en', ...PREFIXED_LOCALES].map(
            (alt) =>
              `    <xhtml:link rel="alternate" hreflang="${HREFLANG[alt]}" href="${this.site}${this.localise(u.loc, alt)}"/>`,
          ),
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${this.site}${u.loc}"/>`,
        ].join('\n');

        return [
          '  <url>',
          `    <loc>${loc}</loc>`,
          alternates,
          `    <changefreq>${u.freq}</changefreq>`,
          // English is the canonical version, so it keeps the stated priority
          // and translations sit just below it.
          `    <priority>${locale === 'en' ? u.priority : (Number(u.priority) - 0.1).toFixed(1)}</priority>`,
          '  </url>',
        ].join('\n');
      }),
    );

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      ...localisedEntries,
      ...rooms.map(
        (r) =>
          `  <url><loc>${this.site}/rooms/${r.id}</loc><lastmod>${r.updatedAt.toISOString().split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      ),
      '</urlset>',
    ].join('\n');

    res.send(xml);
  }

  /** '/pricing' + 'zu' → '/zu/pricing'. English stays unprefixed. */
  private localise(path: string, locale: string): string {
    if (locale === 'en') return path;
    return path === '/' ? `/${locale}` : `/${locale}${path}`;
  }
}
