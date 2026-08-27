import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const SALT_ROUNDS = 12;
const RESET_TTL_MINUTES = 60;
const EMAIL_CHANGE_TTL_MINUTES = 60;

/**
 * Password reset and credential changes.
 *
 * Design notes that matter more than the code:
 *
 * - Only a SHA-256 hash of each token is stored. A leaked database must not
 *   hand an attacker a set of working reset links.
 * - "Forgot password" always reports success, whether or not the address
 *   exists. Saying "no account with that email" turns the endpoint into a free
 *   membership oracle — on a platform where membership implies you are looking
 *   for a room or letting one, that is personal information under POPIA.
 * - Tokens are single-use and every outstanding token for a user is
 *   invalidated once one is spent, so an intercepted older email is dead.
 * - Changing an email is confirmed at the NEW address before it is written,
 *   and the OLD address is told, so an account takeover cannot quietly move
 *   the address out from under the owner.
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private hash(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private newToken() {
    // 32 random bytes, url-safe. Long enough that guessing is not a concern.
    return crypto.randomBytes(32).toString('base64url');
  }

  /** Always resolves the same way, whether or not the account exists. */
  async requestPasswordReset(email: string) {
    const normalised = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    if (user && user.isActive) {
      // Google-only accounts have no password to reset.
      if (user.passwordHash) {
        const token = this.newToken();
        await this.prisma.authToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hash(token),
            type: 'password_reset',
            expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
          },
        });
        this.notifications
          .sendPasswordResetEmail(user.email, { fullName: user.fullName, token, ttlMinutes: RESET_TTL_MINUTES })
          .catch(() => {});
      } else {
        this.notifications
          .sendGoogleOnlyAccountEmail(user.email, { fullName: user.fullName })
          .catch(() => {});
      }
    }

    this.logger.log(`Password reset requested for ${normalised} (exists: ${!!user})`);
    return {
      message: 'If an account exists for that address, a reset link is on its way. It expires in an hour.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true },
    });

    if (!record || record.type !== 'password_reset' || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('That reset link is invalid or has expired. Please request a new one.');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // Spend this token and kill any others — an older email must not still work.
      this.prisma.authToken.updateMany({
        where: { userId: record.userId, type: 'password_reset', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    this.notifications
      .sendPasswordChangedEmail(record.user.email, { fullName: record.user.fullName })
      .catch(() => {});

    this.logger.log(`Password reset completed for user ${record.userId}`);
    return { message: 'Your password has been changed. You can log in with it now.' };
  }

  /** Signed-in change. Requires the current password, so a hijacked session alone is not enough. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) {
      throw new BadRequestException('This account signs in with Google and has no password to change.');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Your current password is not correct.');
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must be different from the current one.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) },
    });

    this.notifications.sendPasswordChangedEmail(user.email, { fullName: user.fullName }).catch(() => {});
    return { message: 'Password updated.' };
  }

  /**
   * Email change, step one. Confirmed at the new address; the old address is
   * notified so a takeover cannot silently move the account.
   */
  async requestEmailChange(userId: string, newEmail: string, currentPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const normalised = newEmail.trim().toLowerCase();

    if (!user.passwordHash) {
      throw new BadRequestException('This account signs in with Google. Change the address on your Google account.');
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Your password is not correct.');
    if (normalised === user.email) {
      throw new BadRequestException('That is already your email address.');
    }

    const taken = await this.prisma.user.findUnique({ where: { email: normalised } });
    if (taken) {
      // Deliberately vague for the same reason as password reset.
      throw new BadRequestException('That address cannot be used. Try another.');
    }

    const token = this.newToken();
    await this.prisma.authToken.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        type: 'email_change',
        newEmail: normalised,
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60_000),
      },
    });

    this.notifications.sendEmailChangeConfirmation(normalised, { fullName: user.fullName, token }).catch(() => {});
    this.notifications.sendEmailChangeAlert(user.email, { fullName: user.fullName, newEmail: normalised }).catch(() => {});

    return { message: `Confirm the change from the email we sent to ${normalised}.` };
  }

  async confirmEmailChange(token: string) {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: this.hash(token) } });

    if (!record || record.type !== 'email_change' || record.usedAt || record.expiresAt < new Date() || !record.newEmail) {
      throw new BadRequestException('That confirmation link is invalid or has expired.');
    }

    // Re-check: the address may have been taken since the request.
    const taken = await this.prisma.user.findUnique({ where: { email: record.newEmail } });
    if (taken) throw new BadRequestException('That address is no longer available.');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { email: record.newEmail } }),
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    this.logger.log(`Email changed for user ${record.userId}`);
    return { message: 'Your email address has been updated. Use it to log in from now on.' };
  }
}
