import { Controller, Get, Param, Patch, Post, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NoticeRouter } from './notice-router.service';

/**
 * Reading your own notices — Phase 7g.
 *
 * ── Why this is not optional, and should not have waited
 *
 * `NoticeRouter` has been writing `Notice` rows since v1.85.0 as the channel
 * that works when there is no email address, and until this controller existed
 * **nothing could read them.** The router's own comment calls the notice "the
 * channel that cannot fail for reasons outside our control", which was true of
 * the write and meaningless without a read: a phone-only landlord's "you have a
 * new applicant" went into a table, WhatsApp refused it outside the 24-hour
 * window, and the landlord was told nothing by any channel.
 *
 * That gap mattered much more the moment people could create phone-only
 * accounts through the front door (v1.85.1), which is why it is fixed in the
 * same release rather than left on the list.
 *
 * Everything here is scoped to the caller in the WHERE clause, never checked
 * after loading: `markRead` on somebody else's notice is a miss, not a refusal,
 * so the endpoint cannot be used to discover that a notice exists.
 */
@ApiTags('notices')
@Controller('notices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NoticesController {
  constructor(private notices: NoticeRouter) {}

  @Get()
  @ApiOperation({ summary: 'Your notices, newest first' })
  all(@CurrentUser() user: { id: string }) {
    return this.notices.all(user.id);
  }

  /**
   * The unread ones, and how many.
   *
   * The count is what the nav badge needs, and it is served with the list
   * rather than as its own endpoint so a portal screen does not make two calls
   * to draw one number.
   */
  @Get('unread')
  @ApiOperation({ summary: 'Unread notices and their count, for the nav badge' })
  async unread(@CurrentUser() user: { id: string }) {
    const items = await this.notices.unread(user.id);
    return { count: items.length, items };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one notice read' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.notices.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  markAllRead(@CurrentUser() user: { id: string }) {
    return this.notices.markAllRead(user.id);
  }
}
