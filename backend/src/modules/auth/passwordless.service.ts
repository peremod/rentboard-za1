import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Short, because a link sitting in an inbox is a standing key to an account. */
const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Passwordless sign-in.
 *
 * This is the answer to how Mastande actually gets used: intensely for a few
 * weeks while someone finds a room, then not for a year. By the time a tenant
 * comes back to leave a review or find their next place, the password is long
 * gone — and a forgotten password is where people give up rather than reset.
 *
 * A magic link removes the credential entirely. The email address is the
 * account, and anyone who can read that inbox can get in — which is already
 * true of any account with password reset.
 */
@Injectable()
export class PasswordlessService {
  private readonly logger = new Logger(PasswordlessService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private hash(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Sends a sign-in link. Reports success either way.
   *
   * Same reasoning as password reset: saying "no account with that email"
   * turns this into a way to test whether someone is on the platform, and on
   * a room-letting site that discloses something about them.
   */
  async requestMagicLink(email: string, intendedRole?: 'TENANT' | 'LANDLORD') {
    const normalised = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    if (user && user.isActive) {
      const token = crypto.randomBytes(32).toString('base64url');

      await this.prisma.authToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hash(token),
          type: 'magic_link',
          expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000),
        },
      });

      this.notifications
        .sendMagicLinkEmail(user.email, {
          fullName: user.fullName,
          token,
          ttlMinutes: MAGIC_LINK_TTL_MINUTES,
        })
        .catch(() => {});
    } else if (!user && intendedRole) {
      // No account: invite them to register rather than leaving them waiting
      // for an email that will never come.
      this.notifications
        .sendNoAccountEmail(normalised, { role: intendedRole })
        .catch(() => {});
    }

    this.logger.log(`Magic link requested for ${normalised} (exists: ${!!user})`);
    return {
      message: 'If that address has an account, a sign-in link is on its way. It expires in 15 minutes.',
    };
  }

  /**
   * Spends a magic link and returns the user for the caller to issue tokens.
   *
   * Single use, and using one invalidates every other outstanding link for
   * that account — a second email sitting in the inbox must not still work.
   */
  async consumeMagicLink(token: string) {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true },
    });

    if (!record || record.type !== 'magic_link' || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('That sign-in link is invalid or has expired. Please request a new one.');
    }
    if (!record.user.isActive) {
      throw new BadRequestException('This account has been suspended.');
    }

    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId: record.userId, type: 'magic_link', usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    this.logger.log(`Magic link sign-in: ${record.user.email}`);
    return record.user;
  }
}
