import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantInboxService } from './tenant-inbox.service';

/**
 * The tenant's "what needs my attention right now" — Phase 7d.
 *
 * No role guard beyond being signed in, and scoped entirely in the WHERE
 * clauses by `tenantId`. A LANDLORD account can hold applications and a
 * tenancy of their own — they rent somewhere too — and a guard here would hide
 * their own messages and their own lease from them for no gain.
 */
@ApiTags('tenant-inbox')
@Controller('tenant-inbox')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TenantInboxController {
  constructor(private inbox: TenantInboxService) {}

  @Get()
  @ApiOperation({
    summary: 'Everything waiting on this person as a tenant, most pressing first',
    description:
      'An acceptance to answer, an unread message, a month their landlord has not recorded, a lease ending, a Passport about to lapse. Aggregated from what is already stored; no new tables.',
  })
  inboxFor(@CurrentUser() user: { id: string }) {
    return this.inbox.inbox(user.id);
  }
}
