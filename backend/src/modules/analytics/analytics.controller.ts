import { Controller, Post, Get, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  /**
   * Report an event. Public and unauthenticated because it stores nothing
   * about the caller — there is no identity to check.
   *
   * Throttled anyway: someone could still inflate a counter, and a skewed
   * funnel leads to a wrong product decision.
   */
  @Post('event')
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async event(@Body() body: { event: string; segment?: string }) {
    await this.analytics.record(body?.event ?? '', body?.segment);
  }

  @Get('funnels')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listing and application funnels, aggregate only' })
  funnels(@Query('days') days?: string) {
    return this.analytics.getFunnels(days ? Math.min(+days, 365) : 30);
  }

  @Get('content-signals')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'UX signals from existing business data — no tracking involved' })
  contentSignals() {
    return this.analytics.getContentSignals();
  }
}
