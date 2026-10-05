import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { NoticeRouter } from '../notifications/notice-router.service';
import { PhoneOtpService } from './phone-otp.service';
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
    private notice: NoticeRouter,
    private phoneOtp: PhoneOtpService,
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
        // Guarded on the address existing, not on the user existing.
        //
        // A phone-only account (Phase 7g) has nothing to send a reset link TO.
        // That is not an error and must not change the response: this endpoint
        // deliberately answers identically whether or not the address has an
        // account, and a different outcome here would leak which addresses are
        // real. Their route back in is the one-time code, which needs no email.
        if (user.email) {
          this.notifications
            .sendPasswordResetEmail(user.email, { fullName: user.fullName, token, ttlMinutes: RESET_TTL_MINUTES })
            .catch(() => {});
        }
      } else if (user.email) {
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

    // A security alert, so it must reach a phone-only account too: if somebody
    // else changed the password, this is the message that tells them.
    this.notice
      .deliver(record.user, {
        kind: 'password_changed',
        title: 'Your password was changed',
        body: 'If that was not you, sign in with your phone number and change it again straight away.',
        link: '/account/settings',
      }, (email) => this.notifications.sendPasswordChangedEmail(email, { fullName: record.user.fullName }))
      .catch(() => {});

    this.logger.log(`Password reset completed for user ${record.userId}`);
    return { message: 'Your password has been changed. You can log in with it now.' };
  }

  /** Signed-in change. Requires the current password, so a hijacked session alone is not enough. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    phoneCode?: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    /**
     * ⚠️ "This account signs in with Google" was told to people who had never
     * seen Google — Phase 7o.
     *
     * The guard was `if (!user.passwordHash)`, which was written when the only
     * way to have no password was to have signed in with Google. Phase 7g added
     * a second: an account created from a mobile number has no email and no
     * password on purpose. Measured on a real one created through the product's
     * own three-step flow, this endpoint answered:
     *
     *   400 "This account signs in with Google and has no password to change."
     *
     * They have no Google account to go and look at. And it was not merely a
     * wrong sentence: it was the only thing standing between them and ever
     * having a password, which is what makes an account recoverable by email
     * later.
     *
     * So the branch is on WHICH kind of account it is, and a phone-only one
     * sets a first password by proving it holds the handset instead.
     */
    if (!user.passwordHash) {
      if (user.authProvider === 'google') {
        throw new BadRequestException('This account signs in with Google and has no password to change.');
      }
      if (!user.phone || !user.phoneVerified) {
        throw new BadRequestException(
          'There is no password on this account and no verified number to send a code to. '
          + 'Add and verify your mobile number first.',
        );
      }
      if (!phoneCode) {
        throw new BadRequestException(
          'This account has no password yet. Ask for a code on WhatsApp and enter it to set one.',
        );
      }
      await this.phoneOtp.consumeStepUp(userId, phoneCode);
      const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } }),
        // Any outstanding reset is dead, the same as a normal change below.
        this.prisma.authToken.updateMany({
          where: { userId, type: 'password_reset', usedAt: null },
          data: { usedAt: new Date() },
        }),
      ]);
      this.logger.log(`First password set for phone-only user ${userId}`);
      return { message: 'Your password is set. You can sign in with it, or keep using WhatsApp.' };
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    /**
     * ⚠️ 403, not 401, and the difference is a shipped bug.
     *
     * A 401 means "the token you presented is no good", and the frontend's
     * error interceptor correctly reads it that way: it silently refreshes the
     * session and retries the request once. The retry re-sent the same wrong
     * password, came back 401 again, and the interceptor then did what a second
     * failure means — showed "Your session has expired", cleared the session and
     * sent the person to the login page.
     *
     * So the inline "Your current password is not correct." written on the
     * settings screen could never appear: the component was unmounted before it
     * rendered. Typing your own password wrong logged you out. Proven in a
     * browser, not reasoned about.
     *
     * The request was authenticated. What failed is the password typed INTO the
     * form, which is a step-up check on an authorised request — 403.
     */
    if (!valid) throw new ForbiddenException('Your current password is not correct.');
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must be different from the current one.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) },
    });

    this.notice
      .deliver(user, {
        kind: 'password_changed',
        title: 'Your password was changed',
        body: 'If that was not you, sign in with your phone number and change it again straight away.',
        link: '/account/settings',
      }, (email) => this.notifications.sendPasswordChangedEmail(email, { fullName: user.fullName }))
      .catch(() => {});
    return { message: 'Password updated.' };
  }

  /**
   * Email change, step one. Confirmed at the new address; the old address is
   * notified so a takeover cannot silently move the account.
   */
  async requestEmailChange(
    userId: string,
    newEmail: string,
    currentPassword: string,
    phoneCode?: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const normalised = newEmail.trim().toLowerCase();

    /**
     * ⚠️ The same false Google message, on the one path off a phone-only
     * account — Phase 7o.
     *
     * Adding an email is what unlocks the verification fee for a phone-only
     * landlord (Outstanding §11 refuses PayFast without an address) and what
     * makes the account recoverable if the number is lost. This endpoint told
     * them to change the address on a Google account they do not have.
     *
     * The step-up for an account with no password is a code to the verified
     * number. The new address is still confirmed AT that address before it is
     * written, which is the protection that matters here and is unchanged.
     */
    if (!user.passwordHash) {
      if (user.authProvider === 'google') {
        throw new BadRequestException('This account signs in with Google. Change the address on your Google account.');
      }
      if (!user.phone || !user.phoneVerified) {
        throw new BadRequestException(
          'Verify your mobile number first — it is how we check it is really you.',
        );
      }
      if (!phoneCode) {
        throw new BadRequestException(
          'Ask for a code on WhatsApp and enter it, so we know it is you adding this address.',
        );
      }
      await this.phoneOtp.consumeStepUp(userId, phoneCode);
    } else {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      // 403 for the same reason as changePassword above: the request is
      // authenticated, the password typed into the form is what was refused.
      if (!valid) throw new ForbiddenException('Your password is not correct.');
    }
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
    // Warns the OLD address that someone is moving the account. A phone-only user
    // has no old address to warn, and adding an email is not a change of one — so
    // a notice instead, which is still the "was this you?" they need.
    if (user.email) {
      this.notifications.sendEmailChangeAlert(user.email, { fullName: user.fullName, newEmail: normalised }).catch(() => {});
    } else {
      this.notice
        .deliver(user, {
          kind: 'email_added',
          title: 'An email address is being added to your account',
          body: `We sent a confirmation to ${normalised}. If that was not you, change your password.`,
          link: '/account/settings',
        })
        .catch(() => {});
    }

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
