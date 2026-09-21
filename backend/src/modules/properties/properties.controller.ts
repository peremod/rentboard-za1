import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PropertiesService } from './properties.service';
import { RentService } from './rent.service';
import { CreatePropertyDto, UpdatePropertyDto, AssignRoomsDto } from './dto/property.dto';
import { MarkRentDto, DisputeRentDto, RentSettingsDto } from './dto/rent.dto';

/**
 * Yards and rent tracking.
 *
 * Most routes are landlord-only. The two that are not are the tenant's: they
 * can read the rent history for their own tenancy and dispute a month, which
 * is the whole reason the dispute path exists — a tenant who receives "your
 * landlord has marked this unpaid" needs somewhere to answer it.
 */
@ApiTags('properties')
@Controller('properties')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PropertiesController {
  constructor(
    private properties: PropertiesService,
    private rent: RentService,
  ) {}

  @Get('dashboard')
  @UseGuards(LandlordGuard)
  @ApiOperation({
    summary: 'Every yard, every room on it, and who is waiting — in one call',
    description:
      'Rooms not in a yard come back under `ungrouped` rather than being dropped: a landlord who has grouped four of six rooms must still see the other two.',
  })
  dashboard(@CurrentUser() user: { id: string }) {
    return this.properties.dashboard(user.id);
  }

  @Get()
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'Your yards, with room counts' })
  list(@CurrentUser() user: { id: string }) {
    return this.properties.list(user.id);
  }

  @Post()
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'Create a yard' })
  create(@Body() dto: CreatePropertyDto, @CurrentUser() user: { id: string }) {
    return this.properties.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'Rename or relocate a yard' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.properties.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(LandlordGuard)
  @ApiOperation({
    summary: 'Delete a yard. Its rooms survive.',
    description:
      'A yard is a label, not an owner. Deleting one ungroups its rooms and removes nothing — a landlord tidying their dashboard must not be able to destroy six live listings and their applications.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.properties.remove(id, user.id);
  }

  @Post(':id/rooms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'Move rooms into this yard' })
  assignRooms(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoomsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.properties.assignRooms(id, dto, user.id);
  }

  @Delete('rooms/:roomId')
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'Take a room out of its yard. The room is untouched.' })
  unassignRoom(@Param('roomId', ParseUUIDPipe) roomId: string, @CurrentUser() user: { id: string }) {
    return this.properties.unassignRoom(roomId, user.id);
  }

  // ── Rent tracking ────────────────────────────────────────────────────────

  @Patch('rent/settings')
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'How many days after the 1st before a reminder goes out. 0 disables them.' })
  rentSettings(@Body() dto: RentSettingsDto, @CurrentUser() user: { id: string }) {
    return this.rent.updateSettings(dto, user.id);
  }

  @Get('rent/:tenancyId')
  @ApiOperation({ summary: 'Rent history for a tenancy. Either party may read their own.' })
  rentHistory(@Param('tenancyId', ParseUUIDPipe) tenancyId: string, @CurrentUser() user: { id: string }) {
    return this.rent.history(tenancyId, user.id);
  }

  @Patch('rent/:tenancyId/mark')
  @UseGuards(LandlordGuard)
  @ApiOperation({ summary: 'Mark a month paid, unpaid, partial or waived' })
  markRent(
    @Param('tenancyId', ParseUUIDPipe) tenancyId: string,
    @Body() dto: MarkRentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.rent.mark(tenancyId, dto, user.id);
  }

  @Patch('rent/period/:periodId/dispute')
  @ApiOperation({
    summary: "The tenant's answer to a month marked unpaid",
    description:
      'Recorded beside the landlord\'s record, never overwriting it, and it stops further reminders for that month — continuing to chase someone who has said they paid is how a reminder becomes harassment.',
  })
  disputeRent(
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @Body() dto: DisputeRentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.rent.dispute(periodId, dto, user.id);
  }

  @Post('rent/run-reminders')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: run the overdue-rent reminder pass now. Safe to re-run.' })
  runReminders() {
    return this.rent.sendOverdueReminders();
  }
}
