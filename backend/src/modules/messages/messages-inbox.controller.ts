import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagesService } from './messages.service';

/**
 * One inbox across every conversation — Phase 7c.
 *
 * A separate controller because the existing one is mounted at
 * `applications/:applicationId/messages`, which is the right path for a thread
 * and the wrong one for a list of them: there is no application id to put in it.
 *
 * No role guard. Both sides have the same problem — a landlord with six rooms
 * and eleven applicants had seventeen places to check, a tenant with four
 * applications had four — and the service scopes every row to the caller as
 * either the room's lister or the applicant. A guard here would only decide who
 * may ask; the WHERE clause decides what they get.
 */
@ApiTags('messages')
@Controller('messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessagesInboxController {
  constructor(private messages: MessagesService) {}

  @Get('inbox')
  @ApiOperation({
    summary: 'Every conversation you are in, newest activity first',
    description:
      'Each row says who it is with, which room, how many messages are unread, and which channel the last one arrived on — in-app or WhatsApp. A conversation can genuinely use both: a tenant message is forwarded to the landlord over WhatsApp, and a reply there is threaded back here.',
  })
  inbox(@CurrentUser() user: { id: string }) {
    return this.messages.inbox(user.id);
  }
}
