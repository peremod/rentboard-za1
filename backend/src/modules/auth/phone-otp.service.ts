import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';

const OTP_TTL_MINUTES = 10;

/**
 * Wrong guesses allowed against one code before it is burned.
 *
 * Five, and this time something reads it. A six-digit code is one in a million
 * per guess, so five is generous for a person mistyping and useless to anybody
 * working through the space.
 *
 * This is the per-ACCOUNT budget. The @Throttle on the route is per IP, so a
 * distributed attacker gets one budget per address while the account owner gets
 * one in total — which is the wrong way round, and is what this fixes.
 */
const MAX_ATTEMPTS = 5;

/**
 * Codes to one number in 24 hours.
 *
 * The 15-minute limit stops a burst. Without this, someone patient can still put
 * 288 messages a day on a handset they do not own, which is a bill and a form of
 * harassment.
 */
const MAX_CODES_PER_DAY = 10;

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
    // For the OTP hash key — see hash(). The secret lives in the environment,
    // so a read-only database leak stops handing out live sign-in codes.
    private config: ConfigService,
  ) {}

  /** Delegates to the shared helper — two copies of this drifted once already. */
  private normalise(raw: string): string | null {
    return normaliseSaMobile(raw);
  }

  /**
   * HMAC, keyed with the server secret — not a bare digest.
   *
   * It was `sha256(phone:code)` with no key. Salting with the number stops a
   * hash being replayed against a different account, which is worth having, but
   * it does not stop the obvious attack on the stored value: six digits is a
   * million candidates, so anybody who can read `auth_tokens` recovers every
   * outstanding code in about a second on a laptop.
   *
   * With a keyed MAC the stored row is useless without the secret, which lives in
   * the environment rather than the database. A read-only database leak — a
   * backup, a replica, a misconfigured dashboard — stops handing out live sign-in
   * codes.
   *
   * ⚠️ Changing the scheme invalidates codes already in flight. They expire in
   * ten minutes, so the cost is that a handful of people re-request one.
   */
  private hash(code: string, phone: string) {
    const key = this.config.get<string>('jwt.secret') ?? '';
    return crypto.createHmac('sha256', key).update(`${phone}:${code}`).digest('hex');
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

      // A daily ceiling as well as the 15-minute one. The short window stops a
      // burst; without a daily cap, someone patient can still send 288 messages a
      // day to a number they do not own — which is both a WhatsApp bill and a
      // form of harassment.
      const today = await this.prisma.authToken.count({
        where: {
          userId: user.id,
          type: 'phone_otp',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
      });
      if (today >= MAX_CODES_PER_DAY) {
        throw new BadRequestException(
          'Too many codes sent to this number today. Try again tomorrow, or sign in another way.',
        );
      }

      // Six digits, from a CSPRNG rather than Math.random.
      const code = String(crypto.randomInt(100000, 999999));

      // ONE live code at a time. Issuing a second without spending the first left
      // up to three valid codes in flight, which triples the guessing surface for
      // no benefit — the person only ever reads the newest message.
      //
      // Inside a transaction with the create, so there is no instant where the
      // old code is dead and the new one does not exist yet.
      await this.prisma.$transaction([
        this.prisma.authToken.updateMany({
          where: { userId: user.id, type: 'phone_otp', usedAt: null },
          data: { usedAt: new Date() },
        }),
        this.prisma.authToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hash(code, phone),
            type: 'phone_otp',
            expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
          },
        }),
      ]);

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

    /**
     * Found by WHOSE code it is, not by the code itself.
     *
     * This used to be `findUnique({ where: { tokenHash: hash(submitted) } })`,
     * which is elegant — a wrong code simply matches no row — but it makes
     * counting attempts impossible: you cannot increment a counter on a token you
     * could not find. That is why the `MAX_ATTEMPTS` constant sat here for
     * releases doing nothing. The lookup shape was the reason, not an oversight
     * in wiring it up.
     *
     * So: find the outstanding code for this number, then compare. There is only
     * ever one, because requestCode spends the previous one as it issues a new.
     */
    const record = await this.prisma.authToken.findFirst({
      where: {
        type: 'phone_otp',
        usedAt: null,
        user: { phone, phoneVerified: true, isActive: true },
      },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    // No outstanding code, or it has expired. Same message either way — which one
    // it is tells a guesser whether the number has an account.
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('That code is wrong or has expired. Request a new one.');
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      // Burned, so a sixth guess cannot be made against it at all.
      await this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      throw new BadRequestException('Too many wrong codes. Request a new one.');
    }

    /**
     * Compared in constant time.
     *
     * Both sides are fixed-length hex from the same hash, so timingSafeEqual
     * cannot throw on a length mismatch. A plain `!==` on a secret is a timing
     * oracle — small here, since the hash is salted per number and an attacker
     * cannot choose the comparison target, but the correct comparison costs
     * nothing.
     */
    const submitted = Buffer.from(this.hash(code.trim(), phone));
    const expected = Buffer.from(record.tokenHash);
    const matches =
      submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);

    if (!matches) {
      const updated = await this.prisma.authToken.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = MAX_ATTEMPTS - updated.attempts;
      throw new BadRequestException(
        left > 0
          ? `That code is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left before you need a new one.`
          : 'Too many wrong codes. Request a new one.',
      );
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

    // Never the email: it is nullable now, so this logged "undefined" for exactly
    // the phone-only accounts this feature exists for. The id is what a log
    // reader can act on anyway.
    this.logger.log(`Phone sign-in: user ${record.user.id}`);
    return record.user;
  }
}
