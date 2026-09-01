import { Controller, Get, Post, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@Controller('referrals')
export class ReferralsController {
  constructor(private referralsService: ReferralsService) {}

  /**
   * Public code check, used by the signup form.
   *
   * Throttled: an unauthenticated endpoint that says whether a code exists is
   * enumerable, and the reply deliberately carries only a display name, never
   * an id or email.
   */
  @Get('validate')
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Check a referral code before signing up' })
  validate(@Query('code') code: string) {
    return this.referralsService.validateCode(code ?? '');
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your code, who you referred, and what you have earned' })
  mine(@CurrentUser() user: { id: string }) {
    return this.referralsService.getMyReferrals(user.id);
  }

  @Post('mine/code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create your referral code if you do not have one' })
  createCode(@CurrentUser() user: { id: string }) {
    return this.referralsService.getOrCreateMyCode(user.id);
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Referral performance, including per-city launch redemptions' })
  stats() {
    return this.referralsService.getStats();
  }

  @Get('admin/launch-codes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Launch invite codes, optionally filtered by city' })
  launchCodes(@Query('city') city?: string) {
    return this.referralsService.listLaunchCodes(city);
  }
}
