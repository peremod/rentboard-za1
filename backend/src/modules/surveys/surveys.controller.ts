import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
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
    return this.surveys.submit(user.id, slug, dto.answers, dto.source, {
      complete: dto.complete ?? true,
    });
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
  results(
    @Param('slug') slug: string,
    @Query('version') version?: string,
    @Query('role') role?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includePartial') includePartial?: string,
  ) {
    return this.surveys.aggregate(slug, this.readFilters(version, role, from, to, includePartial));
  }

  /**
   * The same aggregate as a CSV, for an admin who wants it in a spreadsheet.
   *
   * ⚠️ Counts and open text, exactly what the screen shows — NOT a row per
   * person. An export that carried one line per respondent would turn an
   * aggregate nobody can read back against an individual into a file that
   * can, which is the whole POPIA position of this feature given away by a
   * download button.
   */
  @Get('admin/:slug/results.csv')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The same counts as a CSV — aggregate only, never per person' })
  async csv(
    @Res() res: Response,
    @Param('slug') slug: string,
    @Query('version') version?: string,
    @Query('role') role?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includePartial') includePartial?: string,
  ) {
    const body = await this.surveys.csv(slug, this.readFilters(version, role, from, to, includePartial));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-results.csv"`);
    res.send(body);
  }

  /**
   * ⚠️ Parsed once, here, for both routes.
   *
   * A second copy of this parsing in the CSV route is how the screen and the
   * download come to disagree about what "this month, landlords only" means —
   * and the download is the one nobody checks.
   */
  private readFilters(version?: string, role?: string, from?: string, to?: string, includePartial?: string) {
    const asRole = role === 'LANDLORD' || role === 'TENANT' ? (role as UserRole) : undefined;
    const asDate = (value?: string) => {
      if (!value) return undefined;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };
    const asVersion = version && /^\d+$/.test(version) ? Number(version) : undefined;
    return {
      version: asVersion,
      role: asRole,
      from: asDate(from),
      to: asDate(to),
      includePartial: includePartial === 'true',
    };
  }
}
