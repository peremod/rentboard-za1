import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LandlordInboxService } from './landlord-inbox.service';

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
  constructor(private inboxService: LandlordInboxService) {}

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
}
