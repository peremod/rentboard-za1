import { Controller, Query, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ListerGuard } from '../../common/guards/lister.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';
import { ApplicantInboxDto } from './dto/inbox.dto';

@ApiTags('applications')
@Controller('applications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApplicationsController {
  constructor(private applicationsService: ApplicationsService) {}

  // ── Tenant ──
  @Post()
  create(@Body() dto: CreateApplicationDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.create(dto, user.id);
  }

  @Get('mine')
  getMine(@CurrentUser() user: { id: string }) {
    return this.applicationsService.getMyApplications(user.id);
  }

  // ── Landlord: applicant manager ──
  /**
   * Every applicant across everything you let — Phase 7c.
   *
   * Declared BEFORE `room/:roomId` deliberately: Nest matches routes in
   * declaration order, and `inbox` would otherwise be read as a room id by the
   * route above it and answer a 400 from ParseUUIDPipe.
   */
  @Get('inbox')
  @UseGuards(ListerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'All applicants across every room you let, filterable and sortable',
    description:
      'Applicants were per-room only, so a landlord with six rooms had six screens to check. Filter by room or property, sort newest or by what is waiting on you.',
  })
  inbox(@Query() filters: ApplicantInboxDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.inbox(user.id, filters);
  }

  @Get('room/:roomId')
  @UseGuards(ListerGuard)
  getForRoom(@Param('roomId', ParseUUIDPipe) roomId: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.getRoomApplications(roomId, user.id);
  }

  @Post(':id/withdraw')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tenant withdraws their own application' })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.withdraw(id, user.id);
  }

  @Post(':id/view')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  markViewed(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.markViewed(id, user.id);
  }

  @Post(':id/shortlist')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  shortlist(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.shortlist(id, user.id);
  }

  @Post(':id/undo-accept')
  @UseGuards(JwtAuthGuard, ListerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reverse an acceptance within 30 minutes',
    description: 'Reinstates applicants this acceptance rejected and puts the room back on the board.',
  })
  undoAccept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.undoAccept(id, user.id);
  }

  @Post(':id/unshortlist')
  @UseGuards(JwtAuthGuard, ListerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an applicant from the shortlist' })
  unshortlist(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.unshortlist(id, user.id);
  }

  @Post(':id/accept')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.accept(id, user.id);
  }

  @Post(':id/reject')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectApplicationDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.reject(id, user.id, dto);
  }
}
