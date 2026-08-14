import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@ApiTags('applications')
@Controller('applications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApplicationsController {
  constructor(private applicationsService: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto, @CurrentUser() user: { id: string }) {
    return this.applicationsService.create(dto, user.id);
  }

  @Get('mine')
  getMine(@CurrentUser() user: { id: string }) {
    return this.applicationsService.getMyApplications(user.id);
  }
}
