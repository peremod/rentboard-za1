import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PayfastService } from './payfast.service';

/** The once-off landlord verification fee, in ZAR cents. Matches the pricing page. */
export const VERIFICATION_FEE_CENTS = 14900;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private payfast: PayfastService,
    private config: ConfigService,
  ) {}

  /**
   * Start a payment for a verification request.
   *
   * Charge before review, not after: reviewing first means chasing money from
   * someone you have just told no. The pricing page promises a refund if
   * verification fails, which is the fairer side of that trade.
   */
  async startVerificationPayment(userId: string, verificationRequestId: string) {
    if (!this.payfast.isConfigured) {
      throw new BadRequestException(
        'Payments are not configured on this server. Set PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY.',
      );
    }

    const request = await this.prisma.verificationRequest.findUnique({
      where: { id: verificationRequestId },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (!request) throw new NotFoundException('Verification request not found');
    if (request.userId !== userId) throw new BadRequestException('That is not your verification request');
    if (request.status !== 'pending_payment') {
      throw new BadRequestException('This request has already been paid for.');
    }

    // Reuse an unfinished attempt rather than stacking rows for one user
    // clicking pay twice.
    const existing = await this.prisma.payment.findFirst({
      where: { userId, referenceId: verificationRequestId, status: 'pending' },
    });

    const payment = existing ?? await this.prisma.payment.create({
      data: {
        userId,
        purpose: 'landlord_verification',
        referenceId: verificationRequestId,
        amountCents: VERIFICATION_FEE_CENTS,
        // Prefixed so it is identifiable in the PayFast dashboard at a glance.
        merchantReference: `RBV-${crypto.randomBytes(8).toString('hex')}`,
        provider: 'payfast',
      },
    });

    const frontend = this.config.get<string>('frontendUrl');
    const api = this.config.get<string>('apiUrl') ?? frontend?.replace('4200', '3000');

    const fields = this.payfast.buildPaymentFields({
      merchantReference: payment.merchantReference,
      amountCents: payment.amountCents,
      itemName: 'RentBoard landlord verification',
      itemDescription: 'One-off identity check. Refunded in full if we cannot verify you.',
      buyerEmail: request.user.email,
      buyerFirstName: request.user.fullName.split(' ')[0],
      returnUrl: `${frontend}/landlord/verification?payment=success`,
      cancelUrl: `${frontend}/landlord/verification?payment=cancelled`,
      notifyUrl: `${api}/api/payments/payfast/notify`,
    });

    return {
      paymentId: payment.id,
      processUrl: this.payfast.processUrl,
      // The client renders these as a hidden form and submits it.
      fields,
    };
  }

  /**
   * Handle an ITN. Must be idempotent: PayFast retries, and a retry must not
   * approve a second time or double-count anything.
   */
  async handleItn(payload: Record<string, string>, sourceIp?: string) {
    const merchantReference = payload.m_payment_id;
    if (!merchantReference) {
      this.logger.warn('ITN with no m_payment_id — ignoring');
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { merchantReference },
    });
    if (!payment) {
      this.logger.warn(`ITN for unknown reference ${merchantReference}`);
      return;
    }

    if (payment.status === 'paid') {
      this.logger.log(`ITN replay for ${merchantReference} — already paid, ignoring`);
      return;
    }

    const check = await this.payfast.validateItn(payload, sourceIp, payment.amountCents);
    if (!check.valid) {
      this.logger.error(`ITN rejected for ${merchantReference}: ${check.reason}`);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failedAt: new Date(), failureReason: check.reason, itnPayload: payload },
      });
      return;
    }

    const status = payload.payment_status;
    if (status !== 'COMPLETE') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: status === 'CANCELLED' ? 'cancelled' : 'failed',
          failedAt: new Date(),
          failureReason: `PayFast status: ${status}`,
          itnPayload: payload,
        },
      });
      return;
    }

    // Paid. Move the verification into the review queue in the same
    // transaction, so a request can never be paid but not queued.
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          providerReference: payload.pf_payment_id ?? null,
          itnPayload: payload,
        },
      }),
      ...(payment.referenceId
        ? [
            this.prisma.verificationRequest.updateMany({
              where: { id: payment.referenceId, status: 'pending_payment' },
              data: { status: 'pending' },
            }),
          ]
        : []),
    ]);

    this.logger.log(`Payment ${merchantReference} confirmed; verification queued for review`);
  }

  listMine(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      select: {
        id: true, purpose: true, amountCents: true, status: true,
        paidAt: true, refundedAt: true, createdAt: true, merchantReference: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Record a refund. PayFast refunds are issued from their dashboard rather
   * than by API, so this records the outcome — it does not move money.
   */
  async recordRefund(paymentId: string, reason: string, adminId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'paid') throw new BadRequestException('Only a paid payment can be refunded');

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'refunded', refundedAt: new Date(), refundReason: reason },
    });

    this.logger.warn(`Refund recorded for ${payment.merchantReference} by admin ${adminId}: ${reason}`);
    return updated;
  }
}
