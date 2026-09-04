import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/**
 * Phone sign-in with a code delivered over WhatsApp.
 *
 * The best fit for this market: nearly universal, no password, and the number
 * is something people keep for years even when they forget everything else.
 *
 * Note this is NOT "sign in with WhatsApp" — Meta does not offer WhatsApp as
 * an identity provider. This is phone authentication that happens to use
 * WhatsApp as the delivery channel, which is a different and simpler thing.
 */
@Injectable()
export class PhoneOtpService {
  private readonly logger = new Logger(PhoneOtpService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
  ) {}

  /** +27821234567 — one canonical form, so a number matches however it was typed. */
  private normalise(raw: string): string | null {
    const digits = raw.replace(/[^\d+]/g, '');
    if (/^0[6-8]\d{8}$/.test(digits)) return `+27${digits.slice(1)}`;
    if (/^\+27[6-8]\d{8}$/.test(digits)) return digits;
    if (/^27[6-8]\d{8}$/.test(digits)) return `+${digits}`;
    return null;
  }

  private hash(code: string, phone: string) {
    // Salted with the number so an intercepted hash cannot be replayed against
    // a different account.
    return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
  }

  /**
   * Sends a code. Reports success whether or not the number has an account,
   * for the same reason password reset does.
   */
  async requestCode(rawPhone: string) {
    const phone = this.normalise(rawPhone);
    if (!phone) {
      throw new BadRequestException('Enter a valid South African mobile number, e.g. 082 123 4567');
    }

    const user = await this.prisma.user.findFirst({
      where: { phone, phoneVerified: true, isActive: true },
    });

    if (user) {
      // Rate limit per number, not just per IP: each message costs money and
      // an open endpoint is an easy way to run up a WhatsApp bill.
      const recent = await this.prisma.authToken.count({
        where: {
          userId: user.id,
          type: 'phone_otp',
          createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
        },
      });
      if (recent >= 3) {
        throw new BadRequestException('Too many codes requested. Please wait 15 minutes.');
      }

      // Six digits, from a CSPRNG rather than Math.random.
      const code = String(crypto.randomInt(100000, 999999));

      await this.prisma.authToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hash(code, phone),
          type: 'phone_otp',
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
        },
      });

      this.whatsapp
        .sendOtp(phone, code, OTP_TTL_MINUTES)
        .catch((err) => this.logger.error(`OTP send failed for ${phone}`, err));
    }

    this.logger.log(`OTP requested for ${phone} (account: ${!!user})`);
    return {
      message: `If that number has an account, a code is on its way on WhatsApp. It expires in ${OTP_TTL_MINUTES} minutes.`,
    };
  }

  /** Verifies a code and returns the user for the caller to issue a session. */
  async verifyCode(rawPhone: string, code: string) {
    const phone = this.normalise(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid South African mobile number');

    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(code.trim(), phone) },
      include: { user: true },
    });

    if (!record || record.type !== 'phone_otp' || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('That code is wrong or has expired. Request a new one.');
    }
    if (!record.user.isActive) {
      throw new BadRequestException('This account has been suspended.');
    }

    await this.prisma.$transaction([
      // Spend every outstanding code, so an earlier message cannot be reused.
      this.prisma.authToken.updateMany({
        where: { userId: record.userId, type: 'phone_otp', usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    this.logger.log(`Phone sign-in: ${record.user.email}`);
    return record.user;
  }
}
