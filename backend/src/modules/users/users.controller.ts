import { Controller, Patch, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
