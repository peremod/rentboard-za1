import {
  Controller, Post, Get, Patch, Body, Param, Req, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

class RefundDto {
  @IsString() @MinLength(5) @MaxLength(300)
  reason!: string;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private paymentsService: PaymentsService) {}

  @Post('verification/:verificationRequestId')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start payment for a verification request' })
  startVerification(
    @Param('verificationRequestId', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.paymentsService.startVerificationPayment(user.id, id);
  }

  /**
   * PayFast ITN. Public and unauthenticated by necessity — PayFast calls it
   * server-to-server. Security comes from signature verification, amount
   * checking and the server confirmation callback, not from a guard.
   *
   * Always returns 200: PayFast retries anything else, and a retry storm
   * helps nobody. Failures are recorded against the payment instead.
   */
  @Post('payfast/notify')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async payfastNotify(@Body() payload: Record<string, string>, @Req() req: Request) {
    const sourceIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    try {
      await this.paymentsService.handleItn(payload, sourceIp);
    } catch (err) {
      this.logger.error('ITN handling failed', err as Error);
    }
    return { received: true };
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your payment history' })
  mine(@CurrentUser() user: { id: string }) {
    return this.paymentsService.listMine(user.id);
  }

  @Get('refunds-due')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fees owed back and not yet returned',
    description:
      'Rejecting a paid verification sets the obligation automatically. Work this list in the PayFast dashboard, then record each one with PATCH /payments/:id/refund.',
  })
  refundsDue() {
    return this.paymentsService.refundsDue();
  }

  @Patch(':id/refund')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Record a refund',
    description: 'PayFast refunds are issued from their dashboard; this records the outcome.',
  })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.paymentsService.recordRefund(id, dto.reason, admin.id);
  }
}
