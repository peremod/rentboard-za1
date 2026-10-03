import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SurveysService } from './surveys.service';
import { SubmitSurveyDto } from './dto/submit-survey.dto';

@ApiTags('surveys')
@Controller('surveys')
export class SurveysController {
  constructor(private surveys: SurveysService) {}

  /**
   * What to show this landlord, or null for "ask nothing".
   *
   * Null is the common case and is not an error — the dashboard renders
   * nothing at all. Deciding this on the server is the point: eligibility
   * depends on room count, on whether they have answered, and on a dismissal
   * window, none of which a client should be trusted to evaluate about itself.
   */
  @Get('prompt')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The survey to show you now, or null' })
  prompt(@CurrentUser() user: { id: string }, @Query('slug') slug?: string) {
    return this.surveys.promptFor(user.id, slug);
  }

  /**
   * Record answers. Partial submissions are accepted deliberately — see the
   * service. Throttled because it writes, not because anyone is expected to
   * answer a survey twenty times a minute.
   */
  @Post(':slug/responses')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Answer a survey' })
  submit(
    @CurrentUser() user: { id: string },
    @Param('slug') slug: string,
    @Body() dto: SubmitSurveyDto,
  ) {
    return this.surveys.submit(user.id, slug, dto.answers, dto.source);
  }

  /** "Not now" — honoured for 30 days, then asked again. */
  @Post(':slug/dismiss')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Skip this survey for now' })
  dismiss(@CurrentUser() user: { id: string }, @Param('slug') slug: string) {
    return this.surveys.dismiss(user.id, slug);
  }

  /**
   * Aggregate counts for admin. Never returns who said what — see the service.
   */
  @Get('admin/:slug/results')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Counts per option and open text, segmented by room count' })
  results(@Param('slug') slug: string) {
    return this.surveys.aggregate(slug);
  }
}
