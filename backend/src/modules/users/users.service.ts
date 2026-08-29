import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        // An empty string clears the number rather than storing "".
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
      },
      select: {
        id: true, email: true, fullName: true, phone: true,
        role: true, avatarPath: true, isVerified: true,
      },
    });
    return user;
  }
}
