import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServiceCategory } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ServicesService } from './services.service';
import { ContractorLeadsService } from './contractor-leads.service';
import { RecordLeadDto, SetLeadRateDto, LeadFeesAgreedDto } from './dto/contractor-lead.dto';
import { CreateServiceProviderDto, UpdateServiceProviderDto } from './dto/service-provider.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(
    private services: ServicesService,
    private leads: ContractorLeadsService,
  ) {}

  /**
   * The directory a landlord reads.
   *
   * Signed in, because it is a landlord tool rather than public content — and
   * because a public list of tradespeople's mobile numbers is a scraping target
   * that would cost those people their afternoons.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active service providers, optionally by category and area' })
  list(@Query('category') category?: ServiceCategory, @Query('area') area?: string) {
    return this.services.listForLandlord(category, area);
  }

  // ── Admin: the list is curated, so these are the only way in ─────────────

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Every provider, including the ones not yet live' })
  listAll() {
    return this.services.listAll();
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a provider. Off by default until switched on.' })
  create(@Body() dto: CreateServiceProviderDto, @CurrentUser() admin: { id: string }) {
    return this.services.create(dto, admin.id);
  }

  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit a provider, or switch it on and off' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceProviderDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.services.update(id, dto, admin.id);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a provider' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.remove(id);
  }

  /**
   * A landlord was handed this contractor's number — Phase 7k.
   *
   * ⚠️ Called when the landlord presses Call or WhatsApp, not when a job
   * happens. The product's job still ends at the number; this records that we
   * passed it on, deduplicated to one per landlord per day.
   *
   * It records a lead and NEVER takes money: contractors have no account, so
   * there is nothing to bill against. See ContractorLeadsService.
   */
  @Post(':id/lead')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record that a landlord was given this contractor's number" })
  recordLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordLeadDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.leads.record(id, user.id, dto.channel);
  }

  /**
   * What each contractor was sent, and what it comes to.
   *
   * ⚠️ A RECORD, not an invoice. The payload says so in its own `disclaimer`
   * field, so a report or an export built on this cannot mistake the figure for
   * an amount owed on an invoice that exists.
   */
  @Get('admin/leads')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leads per contractor and what they come to (a record, not an invoice)' })
  leadSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.leads.summary({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  /**
   * Set a lead rate for a category, from a date.
   *
   * ⚠️ Insert-only — rates are never edited or deleted, because leads point at
   * the one they were created under.
   */
  @Post('admin/lead-rates')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set what a lead costs for a category, from a date' })
  setLeadRate(@Body() dto: SetLeadRateDto, @CurrentUser() admin: { id: string }) {
    return this.leads.setRate(
      dto.category, dto.amountCents, new Date(dto.effectiveFrom), admin.id, dto.note,
    );
  }

  /** Record that a contractor agreed to pay for leads, out of band. */
  @Post('admin/:id/lead-fees-agreed')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that this contractor agreed to pay for leads' })
  recordAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeadFeesAgreedDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.leads.recordAgreement(id, dto.note, admin.id);
  }
}
