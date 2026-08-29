import {
  Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdsService } from './ads.service';
import { CreateCampaignDto, ReviewCampaignDto, CreateAdvertiserDto } from './dto/ads.dto';

@ApiTags('ads')
@Controller('ads')
export class AdsController {
  constructor(private adsService: AdsService) {}

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
    @Query('roomType') roomType?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adsService.getForContext({
      placement: placement || 'board_sidebar',
      province, city, roomType,
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
    if (!target) return res.redirect('/');
    // noopener/noreferrer equivalent: do not leak our URL to the advertiser.
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(target);
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
