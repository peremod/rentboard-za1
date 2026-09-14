import { Controller, Post, Body, Req, Headers, UseGuards, BadRequestException, HttpCode, HttpStatus, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StripeService } from './stripe.service';
import { CreatePlanCheckoutDto, CreatePassportCheckoutDto, CreateBoostCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('stripe')
@Controller('stripe')
export class StripeController {
  constructor(private stripeService: StripeService) {}

  @Post('checkout/plan')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  createPlanCheckout(@Body() dto: CreatePlanCheckoutDto, @CurrentUser() user: { id: string }) {
    return this.stripeService.createPlanCheckout(user.id, dto.planTier, dto.interval);
  }

  @Post('checkout/passport')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createPassportCheckout(@Body() dto: CreatePassportCheckoutDto, @CurrentUser() user: { id: string }) {
    return this.stripeService.createPassportCheckout(user.id, dto.interval);
  }

  @Post('checkout/boost')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  createBoostCheckout(@Body() dto: CreateBoostCheckoutDto, @CurrentUser() user: { id: string }) {
    return this.stripeService.createBoostCheckout(dto.roomId, user.id);
  }

  /**
   * Stripe webhook — publicly reachable by design, verified via signature
   * (never trust the payload without this). Requires the raw request body,
   * which main.ts enables globally via `rawBody: true` on NestFactory.create.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('Raw body not available — check main.ts rawBody config');
    const event = this.stripeService.constructEvent(req.rawBody, signature);
    await this.stripeService.handleWebhookEvent(event);
    return { received: true };
  }
}
