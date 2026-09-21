import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Req, Headers, ForbiddenException, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiExcludeEndpoint, ApiOperation } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WhatsappService } from './whatsapp.service';
import { ListingBotService } from './listing-bot.service';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private whatsapp: WhatsappService,
    private prisma: PrismaService,
    private listingBot: ListingBotService,
  ) {}

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

  /**
   * Meta calls this on every inbound message and delivery-status update.
   *
   * Publicly reachable by design, and therefore signed. Until v1.57.0 this
   * handler verified nothing — anyone who found the URL could post a payload
   * and have it written into a landlord and tenant's private conversation as
   * though the other party had sent it. The GET handshake above checks a
   * verify token, but that is exchanged once when the URL is registered and
   * proves nothing about any later POST.
   *
   * 403 rather than 401: there is no credential to supply. Meta retries on a
   * 5xx, so a rejection must be a 4xx or a forged delivery becomes a retry
   * loop.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receiveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    if (!this.whatsapp.verifySignature(req.rawBody, signature)) {
      throw new ForbiddenException('Invalid signature');
    }
    await this.whatsapp.handleIncomingWebhook(body);
    return { received: true };
  }

  // ── WhatsApp-first listing creation ──────────────────────────────────────

  @Get('drafts')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listings started over WhatsApp, waiting to be finished',
    description:
      'Nothing here is on the board. A draft becomes a room only when it is claimed, and then still has to pass the ordinary publish rules — a cover photo and a 50-character description.',
  })
  drafts(@CurrentUser() user: { id: string }) {
    return this.listingBot.pending(user.id);
  }

  @Post('drafts/:id/claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Turn a WhatsApp draft into a room draft you can finish',
    description:
      'Idempotent: claiming twice returns the same room rather than creating a second one, because a landlord tapping twice on a slow connection should not end up with two listings.',
  })
  async claimDraft(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    const result = await this.listingBot.claim(id, user.id);
    if (!result) throw new NotFoundException('No such draft');
    return result;
  }
}
