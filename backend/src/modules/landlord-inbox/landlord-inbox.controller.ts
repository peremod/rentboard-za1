import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LandlordInboxService } from './landlord-inbox.service';
import { CalendarService } from './calendar.service';

/**
 * The two questions a landlord opens the app with — Phase 5a and 5d.
 *
 * Both are pure reads over what Phases 1–4 already record. Nothing here writes,
 * and nothing here is a new source of truth: a number that disagreed with the
 * screen it came from would be worse than no number.
 */
@ApiTags('landlord')
@Controller('landlord')
@UseGuards(JwtAuthGuard, LandlordGuard)
@ApiBearerAuth()
export class LandlordInboxController {
  constructor(
    private inboxService: LandlordInboxService,
    private calendar: CalendarService,
  ) {}

  @Get('inbox')
  @ApiOperation({
    summary: 'What needs my attention right now',
    description:
      'Applications nobody has answered, leases ending, notice given, and rent not settled — one list, most pressing first. The order is decided here so two screens cannot sort it differently.',
  })
  inbox(@CurrentUser() user: { id: string }) {
    return this.inboxService.inbox(user.id);
  }

  @Get('health')
  @ApiOperation({
    summary: 'How the business is doing, as a paragraph',
    description:
      'Occupancy, days-to-fill and payment reliability, each with the number of things it was computed from. Anything with too little behind it says so rather than reporting a percentage.',
  })
  health(@CurrentUser() user: { id: string }) {
    return this.inboxService.health(user.id);
  }

  @Get('calendar')
  @ApiOperation({
    summary: 'Rent dates, lease endings and notice deadlines in one list',
    description:
      'Days, not timestamps — YYYY-MM-DD in UTC, because "rent is due on the 1st" is not an instant and rendering it as one shows a South African landlord the 31st. Rent dates are GENERATED from live tenancies rather than stored.',
  })
  calendarEntries(@CurrentUser() user: { id: string }) {
    return this.calendar.entries(user.id);
  }

  /**
   * No .ics feed, and it is a decision rather than a missing afternoon.
   *
   * A subscribable calendar is a URL that answers without a session, since
   * Google Calendar fetches it server-side with no cookies. That means a
   * capability token in the URL, which is a long-lived credential exposing a
   * landlord's tenancy dates and tenant names to anyone the link reaches — and
   * calendar URLs get pasted into shared calendars routinely.
   *
   * Doing it properly needs a revocable per-landlord token, a way to see and
   * rotate it, and a decision about what the feed may contain. The brief marks
   * it a stretch and says to check the effort first: this is that check, and the
   * in-app view delivers the value without minting a credential.
   */
}
