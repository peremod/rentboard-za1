import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServiceCategory } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ServicesService } from './services.service';
import { CreateServiceProviderDto, UpdateServiceProviderDto } from './dto/service-provider.dto';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private services: ServicesService) {}

  /**
   * The directory a landlord reads.
   *
   * Signed in, because it is a landlord tool rather than public content — and
   * because a public list of tradespeople's mobile numbers is a scraping target
   * that would cost those people their afternoons.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active service providers, optionally by category and area' })
  list(@Query('category') category?: ServiceCategory, @Query('area') area?: string) {
    return this.services.listForLandlord(category, area);
  }

  // ── Admin: the list is curated, so these are the only way in ─────────────

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Every provider, including the ones not yet live' })
  listAll() {
    return this.services.listAll();
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a provider. Off by default until switched on.' })
  create(@Body() dto: CreateServiceProviderDto) {
    return this.services.create(dto);
  }

  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit a provider, or switch it on and off' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceProviderDto) {
    return this.services.update(id, dto);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a provider' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.remove(id);
  }
}
