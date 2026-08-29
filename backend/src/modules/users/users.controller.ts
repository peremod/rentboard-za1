import { Controller, Patch, Body, UseGuards } from '@nestjs/common';
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
}
