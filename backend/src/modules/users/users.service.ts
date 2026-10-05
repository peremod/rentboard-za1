import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Profile details a user can change themselves.
 *
 * Email and password are deliberately NOT here — both live in
 * AccountRecoveryService because both require the current password and, in the
 * case of email, a confirmation round trip. Allowing them through a general
 * "update profile" call would quietly drop those protections.
 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Store one canonical form. Saving the raw '063...' from the form used to
    // overwrite the '+2763...' written at verification, so a number the user
    // had just verified stopped matching at sign-in.
    let phoneUpdate: { phone: string | null; phoneVerified?: boolean } | null = null;

    if (dto.phone !== undefined) {
      const trimmed = dto.phone.trim();
      const existing = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { phone: true, email: true, passwordHash: true, phoneVerified: true },
      });

      /**
       * ⚠️ This field could lock a person out of the product permanently —
       * Phase 7o.
       *
       * An account created from a mobile number has no email and no password:
       * the verified number is the only credential. Both branches below were
       * written for an account that has an email address, and on one that does
       * not they were measured as:
       *
       *   {"phone": ""}              -> HTTP 500 "Internal server error"
       *   {"phone": "<one digit out>"} -> HTTP 200, and the account is gone
       *
       * The 500 is `users_email_or_phone_required` refusing the row — the
       * database holding a line the application did not know about, and the
       * person getting no sentence they can act on.
       *
       * The 200 is worse. The account then points at a number nobody holds with
       * `phoneVerified: false`, so phone sign-in cannot find it; there is no
       * address for `forgot-password`; and asking for a code on the number
       * actually in their hand answers "a code is on its way on WhatsApp" and
       * sends nothing, because that reply is identical for a number with no
       * account. The product reassures them indefinitely while they are locked
       * out. One keystroke, no warning, no way back.
       *
       * So: when the number is the only way in, this field cannot touch it. The
       * change goes through `PhoneOtpService.requestPhoneChange`, which proves
       * the new number BEFORE it replaces the old one.
       */
      const numberIsTheOnlyWayIn = !existing.email && !existing.passwordHash;

      if (!trimmed) {
        if (numberIsTheOnlyWayIn) {
          throw new BadRequestException(
            'This number is the only way into your account — removing it would lock you out. '
            + 'Add an email address first, then you can remove it.',
          );
        }
        // Clearing the number must clear the verification with it.
        phoneUpdate = { phone: null, phoneVerified: false };
      } else {
        const canonical = normaliseSaMobile(trimmed);
        if (!canonical) {
          throw new BadRequestException('Enter a valid South African mobile number, e.g. 082 123 4567');
        }
        if (numberIsTheOnlyWayIn && canonical !== existing.phone) {
          throw new BadRequestException(
            'This number is the only way into your account, so we confirm a new one before changing it. '
            + 'Use "Change my number" — we send a code to the new number and your current one keeps '
            + 'working until it arrives.',
          );
        }
        // Changing to a different number un-verifies it: nobody has proved
        // they own the new one.
        phoneUpdate = existing.phone === canonical
          ? { phone: canonical }
          : { phone: canonical, phoneVerified: false };
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(phoneUpdate ?? {}),
        ...(dto.marketingEmails !== undefined ? { marketingEmails: dto.marketingEmails } : {}),
      },
      select: {
        id: true, email: true, fullName: true, phone: true,
        role: true, avatarPath: true, isVerified: true, marketingEmails: true,
        phoneVerified: true,
      },
    });
    return user;
  }

  /**
   * Stamp or clear the walkthrough — Phase 7f.
   *
   * Returns the new value rather than nothing, so the client can set its own
   * state from what the server actually stored instead of assuming the write
   * went through. The same reason the notices endpoints return their count.
   */
  async setWalkthroughSeen(userId: string, seen: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { walkthroughSeenAt: seen ? new Date() : null },
      select: { walkthroughSeenAt: true },
    });
    return { walkthroughSeenAt: user.walkthroughSeenAt };
  }
}

