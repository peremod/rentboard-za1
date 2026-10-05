import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LostNumberService } from './lost-number.service';
import {
  OpenRecoveryDto, RecordRecoveryCheckDto, RefuseRecoveryDto, ConfirmRecoveryDto,
} from './dto/lost-number.dto';

/**
 * Getting back in when the phone is gone — the admin side.
 *
 * ⚠️ Every route here but the last is admin-only, and the last one is
 * deliberately public. The person recovering has no session — that is the whole
 * premise — so there is nothing to authenticate; what stands in for it is
 * holding the handset the approved code went to.
 *
 * Opening is admin-only rather than open to anybody for the same reason
 * assisted sign-up is: a public "somebody wants to take over the account on
 * this number" endpoint is a way to send that notice to arbitrary people, and
 * there is no self-service version of this that is safe.
 */
@ApiTags('admin')
@Controller('admin/recoveries')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class LostNumberAdminController {
  constructor(private lost: LostNumberService) {}

  @Get('lookup')
  @ApiOperation({
    summary: 'Is there an account on this number, and is a hand-over the right route for it?',
  })
  lookup(@Query('phone') phone: string) {
    return this.lost.lookup(phone ?? '');
  }

  @Get()
  @ApiOperation({ summary: 'The recovery queue, and what was checked on each' })
  list(@Query('status') status?: 'open' | 'approved' | 'recovered' | 'refused' | 'expired') {
    return this.lost.list(status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a request. Nothing is checked and nothing moves.' })
  open(@Body() dto: OpenRecoveryDto, @CurrentUser() admin: { id: string }) {
    return this.lost.open(admin.id, dto);
  }

  @Post(':id/checked')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record what identity was checked — named, dated, in your words' })
  recordCheck(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordRecoveryCheckDto) {
    return this.lost.recordCheck(id, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve and send a code to the new number. Refused without a recorded ID check.',
  })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: { id: string }) {
    return this.lost.approve(admin.id, id);
  }

  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refuse it, with a reason somebody can review' })
  refuse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefuseRecoveryDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.lost.refuse(admin.id, id, dto.reason);
  }

  @Post('expire-stale')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Expire requests nobody finished, and drop their numbers' })
  expireStale() {
    return this.lost.expireStale();
  }
}

/**
 * The one public route: the new handset answering.
 *
 * ⚠️ Not authenticated, on purpose. See the note above. Rate limited hard,
 * because it is a public endpoint that takes a number and a six-digit code.
 */
@ApiTags('auth')
@Controller('auth/lost-number')
export class LostNumberPublicController {
  constructor(private lost: LostNumberService) {}

  @Post('confirm')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enter the code sent to the new number, and take the account back' })
  confirm(@Body() dto: ConfirmRecoveryDto) {
    return this.lost.confirm(dto.phone, dto.code);
  }
}
