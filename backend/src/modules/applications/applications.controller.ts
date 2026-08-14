import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
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
  @UseGuards(LandlordGuard)
  getForRoom(@Param('roomId', ParseUUIDPipe) roomId: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.getRoomApplications(roomId, user.id);
  }

  @Post(':id/view')
  @UseGuards(LandlordGuard)
  @HttpCode(HttpStatus.OK)
  markViewed(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.markViewed(id, user.id);
  }

  @Post(':id/shortlist')
  @UseGuards(LandlordGuard)
  @HttpCode(HttpStatus.OK)
  shortlist(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.shortlist(id, user.id);
  }

  @Post(':id/accept')
  @UseGuards(LandlordGuard)
  @HttpCode(HttpStatus.OK)
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.applicationsService.accept(id, user.id);
  }

  @Post(':id/reject')
  @UseGuards(LandlordGuard)
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectApplicationDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.reject(id, user.id, dto);
  }
}
