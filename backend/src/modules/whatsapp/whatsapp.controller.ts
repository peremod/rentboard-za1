import { Controller, Get, Post, Patch, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WhatsappService } from './whatsapp.service';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private whatsapp: WhatsappService, private prisma: PrismaService) {}

  @Patch('config')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  async updateConfig(@Body() dto: UpdateWhatsappConfigDto, @CurrentUser() user: { id: string }) {
    const profile = await this.prisma.landlordProfile.findUniqueOrThrow({ where: { userId: user.id } });
    return this.whatsapp.updateConfig(profile.id, dto);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  async getConfig(@CurrentUser() user: { id: string }) {
    const profile = await this.prisma.landlordProfile.findUniqueOrThrow({ where: { userId: user.id } });
    return this.whatsapp.getConfig(profile.id);
  }

  /** Meta's one-time webhook verification handshake — publicly reachable by design. */
  @Get('webhook')
  @ApiExcludeEndpoint()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.whatsapp.verifyWebhook(mode, token, challenge);
  }

  /** Meta calls this on every inbound message / delivery-status update — publicly reachable by design. */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receiveWebhook(@Body() body: any) {
    await this.whatsapp.handleIncomingWebhook(body);
    return { received: true };
  }
}
