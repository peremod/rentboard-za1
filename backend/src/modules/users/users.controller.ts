import { Controller, Patch, Post, Body, Param, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isScreenHint } from './screen-hints';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Patch('me')
  @ApiOperation({
    summary: 'Update your own name or phone number',
    description: 'Email and password changes go through /auth — both need the current password.',
  })
  updateMe(@Body() dto: UpdateProfileDto, @CurrentUser() user: { id: string }) {
    return this.usersService.updateProfile(user.id, dto);
  }

  /**
   * The walkthrough has been seen — Phase 7f.
   *
   * Idempotent, and it does not take a step number. A person who closed it on
   * step two has decided they have seen enough, and recording "got to step 2"
   * would only invite a later version to resume them in the middle of
   * something they walked away from.
   */
  /**
   * Put one screen's first-use hint away.
   *
   * One key per call rather than a whole array: the client never sends the set
   * it believes in, so it cannot overwrite a dismissal made on another device
   * with a stale copy. The response carries the authoritative set back.
   */
  @Post('me/hints/:key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record that this account has put a screen's first-use hint away" })
  markHint(@Param('key') key: string, @CurrentUser() user: { id: string }) {
    if (!isScreenHint(key)) {
      // Named, so a typo in a template is a 400 that says which key, rather
      // than a hint that silently never goes away.
      throw new BadRequestException(`"${key}" is not a screen hint. See SCREEN_HINTS.`);
    }
    return this.usersService.markHintSeen(user.id, key);
  }

  @Post('me/walkthrough-seen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that this account has been shown round, so it is not shown again' })
  walkthroughSeen(@CurrentUser() user: { id: string }) {
    return this.usersService.setWalkthroughSeen(user.id, true);
  }

  /**
   * "Show me around again".
   *
   * The brief asks for a way back to the walkthrough, and clearing the stamp is
   * that way: the portal shows it whenever the stamp is null, so one endpoint
   * serves both the first visit and the fifth. A separate "replay" route would
   * be a second path to the same screen with its own state to get wrong.
   */
  @Post('me/walkthrough-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Show the walkthrough again on the next portal screen' })
  walkthroughReset(@CurrentUser() user: { id: string }) {
    return this.usersService.setWalkthroughSeen(user.id, false);
  }
}
