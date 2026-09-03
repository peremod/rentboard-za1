import { Controller, Get, Patch, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';

class SetActiveDto {
  @IsBoolean() isActive!: boolean;

  /** Required when suspending — recorded in the log for accountability. */
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
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

  @Get('rooms')
  @ApiOperation({ summary: 'Recently published rooms, for a moderation sweep' })
  rooms(@Query('limit') limit?: string) {
    return this.adminService.recentRooms(limit ? +limit : 30);
  }
}
