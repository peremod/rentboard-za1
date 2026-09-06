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
      if (!trimmed) {
        // Clearing the number must clear the verification with it.
        phoneUpdate = { phone: null, phoneVerified: false };
      } else {
        const canonical = normaliseSaMobile(trimmed);
        if (!canonical) {
          throw new BadRequestException('Enter a valid South African mobile number, e.g. 082 123 4567');
        }
        const existing = await this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { phone: true },
        });
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
}
