import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

const SITE = 'https://rentboard.co.za';

/**
 * Technical SEO endpoints. Excluded from the /api prefix (see main.ts) so
 * they serve at the domain root where crawlers expect them.
 *
 * The sitemap is generated from live data — every active room is included,
 * and let/draft rooms are excluded so crawlers never index a dead listing.
 */
@Controller()
export class SeoController {
  constructor(private prisma: PrismaService) {}

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain')
  robots(): string {
    return [
      'User-agent: *',
      'Allow: /',
      // Private/authenticated areas — no SEO value, and must not be crawled.
      'Disallow: /auth/',
      'Disallow: /tenant/',
      'Disallow: /landlord/',
      'Disallow: /api/',
      '',
      `Sitemap: ${SITE}/sitemap.xml`,
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

    const staticUrls = [
      { loc: '/', priority: '1.0', freq: 'daily' },
      { loc: '/rooms', priority: '0.9', freq: 'hourly' },
      { loc: '/legal/privacy', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/terms', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/disclaimer', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/cookies', priority: '0.3', freq: 'yearly' },
      { loc: '/legal/paia', priority: '0.3', freq: 'yearly' },
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticUrls.map(
        (u) =>
          `  <url><loc>${SITE}${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`,
      ),
      ...rooms.map(
        (r) =>
          `  <url><loc>${SITE}/rooms/${r.id}</loc><lastmod>${r.updatedAt.toISOString().split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      ),
      '</urlset>',
    ].join('\n');

    res.send(xml);
  }
}
