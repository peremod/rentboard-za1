import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AlertsService } from './alerts.service';
import { SaveSearchDto } from './dto/save-search.dto';

/**
 * Saved searches drive "a room matching your search just went live" alerts.
 * All routes are scoped to the signed-in tenant.
 */
@ApiTags('alerts')
@Controller('alerts/saved-searches')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: "List the tenant's saved searches" })
  list(@CurrentUser() user: { id: string }) {
    return this.alertsService.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Save a search and start receiving alerts' })
  create(@Body() dto: SaveSearchDto, @CurrentUser() user: { id: string }) {
    return this.alertsService.create(dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a saved search, or pause it with isActive:false' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<SaveSearchDto>,
    @CurrentUser() user: { id: string },
  ) {
    return this.alertsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved search' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.alertsService.remove(id, user.id);
  }
}
