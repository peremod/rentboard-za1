import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenanciesService } from './tenancies.service';
import { ConfirmStartDto, EndTenancyDto, CancelTenancyDto } from './dto/tenancy.dto';

/**
 * Tenancies are visible only to the two parties. There is no public listing:
 * who rented where is not information the platform should expose.
 */
@ApiTags('tenancies')
@Controller('tenancies')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TenanciesController {
  constructor(private tenanciesService: TenanciesService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Tenancies where you are the landlord or the tenant' })
  listMine(@CurrentUser() user: { id: string }) {
    return this.tenanciesService.listMine(user.id);
  }

  @Get('reviewable')
  @ApiOperation({ summary: 'Ended tenancies you can still review, and what you owe' })
  reviewable(@CurrentUser() user: { id: string }) {
    return this.tenanciesService.reviewableFor(user.id);
  }

  @Post(':id/confirm-start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the tenant moved in — either party may confirm' })
  confirmStart(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmStartDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenanciesService.confirmStart(id, user.id, dto.startDate);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The letting fell through before move-in. No reviews follow.' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTenancyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenanciesService.cancel(id, user.id, dto.reason);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End an active tenancy. This is what opens reviews.' })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndTenancyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenanciesService.end(id, user.id, dto.reason, dto.endDate);
  }
}
