import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';

const OTP_TTL_MINUTES = 10;

/*
 * There was a `MAX_ATTEMPTS = 5` here that nothing ever read — the file
 * contains no attempt counting at all. It described an intention rather than
 * a control, which is the worst kind of constant to leave lying around: it
 * reads like the protection exists.
 *
 * What actually limits code guessing is the per-route @Throttle in
 * auth.controller.ts (10 per 15 minutes on both phone/verify and, as of this
 * change, phone/confirm-number) against a six-digit space.
 *
 * A genuine per-code cap would be better, since throttling is per IP and this
 * is not, but it needs somewhere to count: AuthToken has no attempts column,
 * so it is a schema migration rather than a constant. Left undone deliberately
 * rather than left looking done.
 */

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

  /** Delegates to the shared helper — two copies of this drifted once already. */
  private normalise(raw: string): string | null {
    return normaliseSaMobile(raw);
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

  /**
   * Sends a code to verify a number the user has just saved.
   *
   * Separate from requestCode, which is for signing in. This one is
   * authenticated and targets the number on the account, because without a
   * verification step phoneVerified is never true and phone sign-in can never
   * find anyone — which is exactly how it shipped.
   */
  async requestVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phone) {
      throw new BadRequestException('Add a mobile number to your profile first.');
    }

    const phone = this.normalise(user.phone);
    if (!phone) {
      throw new BadRequestException('The number on your profile is not a valid South African mobile.');
    }

    // Someone else may already have verified this number — numbers get
    // recycled, and two accounts signing in on one number is a takeover.
    const taken = await this.prisma.user.findFirst({
      where: { phone, phoneVerified: true, id: { not: userId } },
    });
    if (taken) {
      throw new BadRequestException('That number is already verified on another account.');
    }

    const recent = await this.prisma.authToken.count({
      where: {
        userId,
        type: 'phone_otp',
        createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
      },
    });
    if (recent >= 3) {
      throw new BadRequestException('Too many codes requested. Please wait 15 minutes.');
    }

    const code = String(crypto.randomInt(100000, 999999));
    await this.prisma.authToken.create({
      data: {
        userId,
        tokenHash: this.hash(code, phone),
        type: 'phone_otp',
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    });

    await this.whatsapp.sendOtp(phone, code, OTP_TTL_MINUTES);
    this.logger.log(`Verification code sent to ${phone} for user ${userId}`);
    return { message: `Code sent to ${phone} on WhatsApp.` };
  }

  /** Confirms the code and marks the number usable for sign-in. */
  async confirmVerification(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const phone = user.phone ? this.normalise(user.phone) : null;
    if (!phone) throw new BadRequestException('No mobile number on this account.');

    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(code.trim(), phone) },
    });

    if (!record || record.userId !== userId || record.type !== 'phone_otp' ||
        record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('That code is wrong or has expired. Request a new one.');
    }

    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId, type: 'phone_otp', usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        // Store the canonical form, so sign-in matches however it was typed.
        data: { phone, phoneVerified: true },
      }),
    ]);

    this.logger.log(`Phone verified for user ${userId}`);
    return { verified: true, phone, message: 'Number verified. You can now sign in with WhatsApp.' };
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
