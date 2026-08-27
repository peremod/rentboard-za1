import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
   */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
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
