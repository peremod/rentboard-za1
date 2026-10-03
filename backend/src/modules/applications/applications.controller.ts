import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ListerGuard } from '../../common/guards/lister.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';

@ApiTags('applications')
@Controller('applications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApplicationsController {
  constructor(private applicationsService: ApplicationsService) {}

  // ── Tenant ──
  @Post()
  create(@Body() dto: CreateApplicationDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.create(dto, user.id);
  }

  @Get('mine')
  getMine(@CurrentUser() user: { id: string }) {
    return this.applicationsService.getMyApplications(user.id);
  }

  // ── Landlord: applicant manager ──
  @Get('room/:roomId')
  @UseGuards(ListerGuard)
  getForRoom(@Param('roomId', ParseUUIDPipe) roomId: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.getRoomApplications(roomId, user.id);
  }

  @Post(':id/withdraw')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tenant withdraws their own application' })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.withdraw(id, user.id);
  }

  @Post(':id/view')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  markViewed(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.markViewed(id, user.id);
  }

  @Post(':id/shortlist')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  shortlist(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.shortlist(id, user.id);
  }

  @Post(':id/undo-accept')
  @UseGuards(JwtAuthGuard, ListerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reverse an acceptance within 30 minutes',
    description: 'Reinstates applicants this acceptance rejected and puts the room back on the board.',
  })
  undoAccept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.undoAccept(id, user.id);
  }

  @Post(':id/unshortlist')
  @UseGuards(JwtAuthGuard, ListerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an applicant from the shortlist' })
  unshortlist(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.unshortlist(id, user.id);
  }

  @Post(':id/accept')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.accept(id, user.id);
  }

  @Post(':id/reject')
  @UseGuards(ListerGuard)
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectApplicationDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.reject(id, user.id, dto);
  }
}
