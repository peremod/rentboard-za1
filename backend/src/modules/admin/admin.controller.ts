import {
  Controller, Get, Patch, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Equals, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';

class SetActiveDto {
  @IsBoolean() isActive!: boolean;

  /** Required when suspending — recorded in the log for accountability. */
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/**
 * Ending somebody else's account, on their request — Phase 7i.
 *
 * ── Why a reason is required, and ten characters long
 *
 * This erases the email, the name and the phone number, so the audit row is the
 * only lasting evidence that it was ever asked for. "yes" is not evidence. Ten
 * characters is not a quality bar — it is the shortest length at which somebody
 * has had to type a sentence fragment rather than tap a key, and the screen
 * says what the field is for.
 *
 * ── And an acknowledgement that ABSENT is refused
 *
 * `@Equals(true)` rather than `@IsBoolean()`, for the reason the self-service
 * DTO gives: a checkbox whose binding never fired ships as *absent*, not false.
 */
class AdminCloseAccountDto {
  @IsString()
  @MinLength(10, {
    message: 'Record how the request reached you — this is the only lasting evidence that it was asked for.',
  })
  @MaxLength(300)
  reason!: string;

  @Equals('CLOSE', { message: 'Type CLOSE to confirm.' })
  confirm!: string;

  @IsBoolean()
  @Equals(true, { message: 'Confirm that you understand this cannot be undone.' })
  understood!: boolean;
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform counts for the admin dashboard' })
  stats() {
    return this.adminService.getStats();
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Platform health, not just totals. Defaults to 30 days.' })
  kpis(@Query('days') days?: string) {
    return this.adminService.getKpis(days ? Math.min(+days, 365) : 30);
  }

  @Get('growth')
  @ApiOperation({ summary: 'Active users and signups: now, daily, weekly, monthly, yearly' })
  growth() {
    return this.adminService.getGrowth();
  }

  @Get('users')
  @ApiOperation({ summary: 'Search users by email or name' })
  users(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.findUsers(q, role, limit ? +limit : 50);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Everything about one account, for support and moderation' })
  userDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id/active')
  @ApiOperation({ summary: 'Suspend or restore an account' })
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.setUserActive(id, dto.isActive, admin.id, dto.reason);
  }

  @Get('users/:id/closure-preview')
  @ApiOperation({
    summary: 'What ending this account would erase and what it would keep',
    description:
      'The same preview the owner sees on /account/close, so an admin acting on a '
      + 'request is told the same thing the person would have been.',
  })
  closurePreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.closurePreview(id);
  }

  /**
   * ⚠️ DELETE, and separate from the suspend route on purpose.
   *
   * Suspension is `PATCH users/:id/active`: reversible, keeps the email, a
   * moderation decision we make. This is irreversible, erases the email, and is
   * a decision the OWNER made that we are carrying out. One endpoint doing both
   * with a flag is how somebody suspends an account and ends it.
   *
   * Throttled with the guard IN THIS DECORATOR BLOCK. `@Throttle` alone does
   * nothing without it — this codebase shipped nineteen such decorators with no
   * guard registered, and they all looked like rate limiting.
   */
  @Delete('users/:id')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @ApiOperation({
    summary: "End a user's account on their request (irreversible)",
    description:
      'For a request the owner cannot carry out themselves — a phone-only account '
      + 'has no password for /account/close to confirm with. Erases the person and '
      + 'keeps the shared records, exactly as the self-service path does, and writes '
      + 'an audit row naming the admin and the request.',
  })
  closeAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCloseAccountDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.adminService.closeUserAccount(id, admin.id, dto.reason);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Recently published rooms, for a moderation sweep' })
  rooms(@Query('limit') limit?: string) {
    return this.adminService.recentRooms(limit ? +limit : 30);
  }
}
