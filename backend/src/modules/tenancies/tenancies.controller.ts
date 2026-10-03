import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenanciesService } from './tenancies.service';
import { TenancyFlagsService } from './tenancy-flags.service';
import { ConfirmStartDto, EndTenancyDto, CancelTenancyDto } from './dto/tenancy.dto';
import { RaiseFlagDto } from './dto/raise-flag.dto';
import { ReviewFlagDto } from './dto/review-flag.dto';
import { LeaseService } from './lease.service';
import { GiveNoticeDto, UpdateLeaseTermsDto } from './dto/lease.dto';
import { LeaseDocumentsService } from './lease-documents.service';
import { AddLeaseDocumentDto, UpdateLeaseDocumentDto } from './dto/lease-document.dto';

/**
 * Tenancies are visible only to the two parties. There is no public listing:
 * who rented where is not information the platform should expose.
 */
@ApiTags('tenancies')
@Controller('tenancies')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TenanciesController {
  constructor(
    private tenanciesService: TenanciesService,
    private flags: TenancyFlagsService,
    private lease: LeaseService,
    private documents: LeaseDocumentsService,
  ) {}

  // ── Lease terms, renewal and notice ──────────────────────────────────────

  /**
   * What is about to need attention: fixed terms inside the lead window, and
   * tenancies where notice has been given.
   *
   * Computed per request rather than flagged by a nightly job — see the note in
   * LeaseService. A rolling tenancy with no notice appears in neither, because
   * nothing is happening to it.
   */
  @Get('upcoming')
  @ApiOperation({ summary: 'Leases ending soon, and tenancies under notice' })
  upcoming(@CurrentUser() user: { id: string }) {
    return this.lease.upcoming(user.id);
  }

  @Patch(':id/lease')
  @ApiOperation({ summary: 'Set the agreed lease terms. leaseEndDate null means month-to-month.' })
  updateLease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaseTermsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.lease.updateTerms(id, dto, user.id);
  }

  @Post(':id/notice')
  @ApiOperation({ summary: 'Record that notice was given, by either side' })
  giveNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GiveNoticeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.lease.giveNotice(id, dto, user.id);
  }

  @Post(':id/notice/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Notice was given in error, or withdrawn' })
  withdrawNotice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.lease.withdrawNotice(id, user.id);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Tenancies where you are the landlord or the tenant' })
  listMine(@CurrentUser() user: { id: string }) {
    return this.tenanciesService.listMine(user.id);
  }

  @Get('reviewable')
  @ApiOperation({ summary: 'Ended tenancies you can still review, and what you owe' })
  reviewable(@CurrentUser() user: { id: string }) {
    return this.tenanciesService.reviewableFor(user.id);
  }

  @Post(':id/confirm-start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the tenant moved in — either party may confirm' })
  confirmStart(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmStartDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenanciesService.confirmStart(id, user.id, dto.startDate);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The letting fell through before move-in. No reviews follow.' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTenancyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenanciesService.cancel(id, user.id, dto.reason);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End an active tenancy. This is what opens reviews.' })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndTenancyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenanciesService.end(id, user.id, dto.reason, dto.endDate);
  }

  // ── Post-tenancy dispute flags ──────────────────────────────────────────
  //
  // Separate from reviews on purpose. A review is a public star rating open
  // for 30 days; this is a private report to the platform that someone
  // behaved badly, which an admin acts on. An open flag reduces the account's
  // visibility on the board — it does not hide listings or suspend anyone.

  @Post(':id/flag')
  @HttpCode(HttpStatus.CREATED)
  // Harder than the global limit: this writes a mark against another person's
  // account, and there is no legitimate reason to do it in bulk.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiOperation({
    summary: 'Report a problem with the other party, after the tenancy ended',
    description:
      'Who it is against is derived from the tenancy, never supplied — the only two people who can flag each other are the two who were in it.',
  })
  raiseFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RaiseFlagDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.flags.raise(id, dto, user.id);
  }

  @Get('flags/mine')
  @ApiOperation({ summary: 'Reports you have raised, and what came of them' })
  myFlags(@CurrentUser() user: { id: string }) {
    return this.flags.listMine(user.id);
  }

  @Patch('flags/:id/withdraw')
  @ApiOperation({ summary: 'Take back a report you raised, while it is still open' })
  withdrawFlag(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.flags.withdraw(id, user.id);
  }

  @Get('flags/open')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: reports awaiting review, oldest first' })
  openFlags() {
    return this.flags.listOpen();
  }

  @Patch('flags/:id/review')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: uphold or dismiss a report',
    description: 'Dismissing restores the account\'s visibility immediately — a dismissed allegation must not go on costing someone reach.',
  })
  reviewFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewFlagDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.flags.review(id, dto, user.id);
  }

  @Patch('flags/recount')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: recompute openFlagCount from the flags themselves' })
  recountFlags() {
    return this.flags.recount();
  }

  // ── Lease documents ──────────────────────────────────────────────────────
  //
  // Storage, and nothing but. No route here signs, witnesses or timestamps
  // anything, and none is going to without ECT Act advice behind it — see
  // LeaseDocumentsService. There is also NO admin route in this section, which
  // is a decision: a lease names two people, what they pay and where they
  // sleep, and no support task requires reading it.

  @Get(':id/documents')
  @ApiOperation({
    summary: 'The documents stored against a tenancy',
    description:
      'Either party. Storage paths are never returned here — opening a document asks for a short-lived URL of its own.',
  })
  listDocuments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.documents.list(id, user.id);
  }

  @Post(':id/documents')
  @ApiOperation({
    summary: 'Store a signed lease, addendum, inspection or receipt',
    description:
      'Either party may upload. This records that a file exists and who put it there — it is not a signature and asserts nothing about what either party agreed.',
  })
  addDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLeaseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.documents.add(id, dto, user.id);
  }

  @Get('documents/:docId/open')
  @ApiOperation({
    summary: 'A short-lived URL for reading one document',
    description:
      'Party-only, signed, and expires in five minutes — so a link copied out of the app stops working. Asked for when someone opens a file rather than carried in every list.',
  })
  openDocument(@Param('docId', ParseUUIDPipe) docId: string, @CurrentUser() user: { id: string }) {
    return this.documents.openUrlFor(docId, user.id);
  }

  @Patch('documents/:docId')
  @ApiOperation({ summary: 'Rename or recategorise your own upload' })
  updateDocument(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UpdateLeaseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.documents.update(docId, dto, user.id);
  }

  @Delete('documents/:docId')
  @ApiOperation({
    summary: 'Remove your own upload, and delete the file',
    description:
      'Only the uploader, so one party cannot delete the other\u2019s copy of what was agreed. The bytes are queued for deletion from storage, not merely unlinked.',
  })
  removeDocument(@Param('docId', ParseUUIDPipe) docId: string, @CurrentUser() user: { id: string }) {
    return this.documents.remove(docId, user.id);
  }
}
