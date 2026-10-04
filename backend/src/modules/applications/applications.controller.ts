import { Controller, Query, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ListerGuard } from '../../common/guards/lister.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';
import { ApplicantInboxDto } from './dto/inbox.dto';
import { ViewingsService } from './viewings.service';
import { InviteToViewingDto, RespondToViewingDto } from './dto/viewing.dto';

@ApiTags('applications')
@Controller('applications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApplicationsController {
  constructor(
    private applicationsService: ApplicationsService,
    private viewings: ViewingsService,
  ) {}

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

  // ── Viewings — Phase 7l ──────────────────────────────────────────────────
  //
  // ⚠️ Nothing here reads Property.addressLine. The landlord types where to
  // meet, because the form they typed that address into promised them it is
  // "never sent to an applicant". See viewings.service.ts.

  @Post(':id/viewings')
  @ApiOperation({
    summary: 'Invite this applicant to come and see the room',
    description:
      'Landlord only, and only while the application is still live. The meeting place '
      + 'is sent to the applicant, so it is typed per viewing and never taken from the '
      + 'private property address.',
  })
  invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteToViewingDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.viewings.invite(id, user.id, {
      startsAt: new Date(dto.startsAt),
      meetingPlace: dto.meetingPlace,
      note: dto.note,
    });
  }

  @Get(':id/viewings')
  @ApiOperation({ summary: 'Viewings arranged on this application — either party' })
  listViewings(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.viewings.forApplication(id, user.id);
  }

  /** The tenant answers. Only the tenant — see the service. */
  @Post('viewings/:viewingId/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say whether you can make the viewing' })
  respond(
    @Param('viewingId', ParseUUIDPipe) viewingId: string,
    @Body() dto: RespondToViewingDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.viewings.respond(viewingId, user.id, {
      accept: dto.accept,
      declineReason: dto.declineReason,
    });
  }

  /** Either side calls it off. */
  @Post('viewings/:viewingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Call off a viewing — either the landlord or the applicant' })
  cancelViewing(
    @Param('viewingId', ParseUUIDPipe) viewingId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.viewings.cancel(viewingId, user.id);
  }

  /** What this tenant has coming up, across every application they have made. */
  @Get('viewings/mine')
  @ApiOperation({ summary: 'Viewings you have been invited to that have not happened yet' })
  myViewings(@CurrentUser() user: { id: string }) {
    return this.viewings.forTenant(user.id);
  }
}
