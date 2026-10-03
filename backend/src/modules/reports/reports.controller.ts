import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * Open to signed-out visitors on purpose: requiring an account to report a
   * scam suppresses exactly the reports worth having. Rate limited instead.
   *
   * Twenty an hour, raised from five the moment the limit became real — the
   * guard had never been registered, so this decorator had done nothing since
   * it was written (see app.module.ts). Five per hour PER IP is the wrong number
   * for this market: mobile carriers here put very large numbers of subscribers
   * behind one address, so five reports an hour can be an entire neighbourhood's
   * budget, and the sixth person trying to report a scam listing is refused.
   *
   * The asymmetry decides it. A false report costs an admin a minute of triage;
   * a suppressed report leaves a scam listing up. Twenty still stops one host
   * from burying the queue, which is all a per-IP limit can honestly claim.
   */
  @Post()
  @UseGuards(OptionalJwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report a listing or account' })
  create(@Body() dto: CreateReportDto, @Req() req: Request) {
    const user = req.user as { id: string } | undefined;
    return this.reportsService.create(dto, user?.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin report queue' })
  list(@Query('status') status?: string) {
    return this.reportsService.listForAdmin(status);
  }

  @Get(':id/context')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Prior reports against the same room and landlord' })
  context(@Param('id', ParseUUIDPipe) id: string) {
    return this.reportsService.getContext(id);
  }

  @Patch(':id/resolve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a report status with a note' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.reportsService.resolve(id, dto, admin.id);
  }
}
