import {
  Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Header } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdsService } from './ads.service';
import {
  CreateCampaignDto, ReviewCampaignDto, CreateAdvertiserDto,
  CreateAdEnquiryDto, UpdateEnquiryDto,
} from './dto/ads.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';

@ApiTags('ads')
@Controller('ads')
export class AdsController {
  constructor(
    private adsService: AdsService,
    private config: ConfigService,
  ) {}

  /**
   * Ads for a page context. Public and unauthenticated on purpose — no user is
   * identified, so there is nothing to authenticate and nothing to leak.
   */
  @Get()
  @ApiOperation({ summary: 'Ads matching a page context (province, city, room type)' })
  forContext(
    @Query('placement') placement: string,
    @Query('province') province?: string,
    @Query('city') city?: string,
    @Query('suburbSlug') suburbSlug?: string,
    @Query('roomType') roomType?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adsService.getForContext({
      placement: placement || 'board_sidebar',
      province, city, suburbSlug, roomType,
      limit: limit ? Math.min(+limit, 3) : 1,
    });
  }

  @Post('impressions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async impressions(@Body() body: { campaignIds: string[] }) {
    await this.adsService.recordImpressions(body?.campaignIds ?? []);
  }

  /**
   * Counts the click and forwards. Routing through us means no third-party
   * tracking script has to run on the page.
   */
  @Get(':id/click')
  @ApiExcludeEndpoint()
  async click(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const target = await this.adsService.recordClick(id);
    if (!target) return res.redirect(this.siteOrigin());

    // noopener/noreferrer equivalent: do not leak our URL to the advertiser.
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(this.resolveTarget(target));
  }

  /** Where a click belongs when there is nowhere else to send it. */
  private siteOrigin(): string {
    return (this.config.get<string>('frontendUrl') ?? '/').replace(/\/$/, '');
  }

  /**
   * A relative target belongs to the SITE, not to this API.
   *
   * House ads point at our own pages — `/how-it-works`, `/auth/register` —
   * and `res.redirect('/how-it-works')` resolves against the origin serving
   * the redirect, which is api.umastande.co.za. So every click on a house ad
   * landed on `{"message":"Cannot GET /how-it-works","statusCode":404}`, on a
   * hostname the visitor has never heard of. The board's only call to action
   * for a new visitor, and it went to a JSON 404.
   *
   * The smoke test asserted the endpoint returns 301 or 302 and never looked
   * at the Location header, so a redirect to the wrong origin was still a
   * redirect and the check passed.
   *
   * An advertiser's absolute URL is left alone: sending a visitor off-site is
   * what a paid ad click IS, and Referrer-Policy above keeps our URL out of
   * their logs. A protocol-relative `//evil.com` is not treated as absolute
   * here, so it becomes a path on our own site rather than an open redirect.
   */
  private resolveTarget(target: string): string {
    if (/^https?:\/\//i.test(target)) return target;
    return `${this.siteOrigin()}${target.startsWith('/') ? '' : '/'}${target}`;
  }

  @Get('rates')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Rate card: monthly price by placement and targeting reach' })
  rates() {
    return this.adsService.getRateCard();
  }

  /**
   * Public enquiry form. Rate limited — an open contact form that sends mail is
   * the obvious target for spam.
   *
   * (This comment sat above `@Get('rates')` and described this route, which is
   * how a reader ends up believing the rate card is the thing being protected.)
   *
   * Fifteen an hour, raised from three once the limit became real (the guard
   * had never been registered, so this decorator had done nothing since it was
   * written — see app.module.ts). Three per hour PER IP is the wrong number
   * here for two reasons: mobile carriers in this market put very large numbers
   * of subscribers behind one address, and an advertising enquiry is a LEAD.
   * The asymmetry runs the other way from a scam report — a spam enquiry costs
   * somebody a minute in an inbox, a suppressed one is revenue that never
   * arrives and nobody ever hears about.
   */
  @Post('enquiries')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Enquire about advertising on the board' })
  createEnquiry(@Body() dto: CreateAdEnquiryDto) {
    return this.adsService.createEnquiry(dto);
  }

  @Get('enquiries')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Advertising enquiry queue' })
  listEnquiries(@Query('status') status?: string) {
    return this.adsService.listEnquiries(status);
  }

  @Patch('enquiries/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  updateEnquiry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnquiryDto) {
    return this.adsService.updateEnquiry(id, dto);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Post('advertisers')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  createAdvertiser(@Body() dto: CreateAdvertiserDto) {
    return this.adsService.createAdvertiser(dto);
  }

  @Get('advertisers')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  listAdvertisers() {
    return this.adsService.listAdvertisers();
  }

  @Post('campaigns')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  createCampaign(@Body() dto: CreateCampaignDto) {
    return this.adsService.createCampaign(dto);
  }

  @Get('reach-analysis')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Does each targeting level deliver the reach its price assumes?',
    description: 'Compares measured impressions per day against the rate card multipliers.',
  })
  reachAnalysis() {
    return this.adsService.getReachAnalysis();
  }

  @Get('campaigns')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  listCampaigns(@Query('status') status?: string) {
    return this.adsService.listCampaigns(status);
  }

  @Get('campaigns/:id/stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aggregate performance — nothing about who saw it' })
  stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.adsService.getCampaignStats(id);
  }

  @Patch('campaigns/:id/review')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject a creative before it runs' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCampaignDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.adsService.reviewCampaign(id, dto, admin.id);
  }

  @Patch('campaigns/:id/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: 'active' | 'paused' | 'ended' },
  ) {
    return this.adsService.setStatus(id, body.status);
  }
}
