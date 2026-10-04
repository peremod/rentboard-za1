import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountLifecycleService } from './account-lifecycle.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

/**
 * A person's own account: pausing it, waking it, or ending it — Phase 7g.
 *
 * Not in `UsersController`, which is for editing a profile. These four change
 * what the account IS, two of them irreversibly, and keeping them together
 * means the destructive ones are read next to the explanation of what they do
 * rather than scattered among field updates.
 */
@ApiTags('account')
@Controller('account')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountController {
  constructor(private lifecycle: AccountLifecycleService) {}

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put the account to sleep. Listings come off the board; nothing is destroyed',
    description:
      'Sign-in keeps working — that is how you come back. Rooms are PAUSED, which keeps their applications and tenancies attached.',
  })
  deactivate(@CurrentUser() user: { id: string }) {
    return this.lifecycle.deactivate(user.id);
  }

  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Wake the account up',
    description:
      'Rooms are NOT republished: one may have been let in the meantime, and advertising a taken room to people who then apply for it is worse than making the landlord tap publish.',
  })
  reactivate(@CurrentUser() user: { id: string }) {
    return this.lifecycle.reactivate(user.id);
  }

  @Get('deletion-preview')
  @ApiOperation({
    summary: 'What ending this account will erase, and what it will keep',
    description:
      'Counted from this account\'s own rows. A landlord with a live tenancy and a tenant who applied for one room need to be told different things, and a paragraph covering both tells neither anything useful.',
  })
  deletionPreview(@CurrentUser() user: { id: string }) {
    return this.lifecycle.previewDeletion(user.id);
  }

  /**
   * ⚠️ Rate limited, and guarded.
   *
   * `@Throttle` without `ThrottlerGuard` in the same decorator block does
   * nothing at all — nineteen decorators in this codebase proved that by never
   * once limiting anything (see v1.86.0). `scripts/throttle-lint.mjs` fails the
   * build if the pair is ever split again.
   *
   * ⚠️ Ten, not five, and the number was chosen by watching a person fail.
   *
   * The caller already holds a valid session for this account, so what this
   * defends against is somebody who has stolen one and is guessing the password
   * to escalate to deletion — and a password needs thousands of guesses, not
   * ten. What five actually did was lock a legitimate person out of closing
   * their OWN account: the form refuses a missing password, a mistyped one, a
   * lower-case "delete" and an unticked box, so four honest mistakes and one
   * correct attempt is exactly five. The drive hit it on its first run.
   *
   * A limit that stops the owner before it stops an attacker is the wrong
   * limit, however prudent the smaller number looks.
   */
  @Delete()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End the account: erase the personal information, keep the shared record',
    description:
      'Needs the password, the word DELETE typed, and an explicit acknowledgement. The row becomes a tombstone with every personal field erased — deleting it outright would cascade into other people\'s rooms, applications, messages, tenancies, rent history and reviews.',
  })
  deleteAccount(@Body() dto: DeleteAccountDto, @CurrentUser() user: { id: string }) {
    return this.lifecycle.deleteAccount(user.id, { password: dto.password });
  }
}
