import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Admin oversight.
 *
 * Scope is deliberately narrow: reviewing verification documents, seeing
 * platform health, and suspending accounts that abuse the platform. It does
 * NOT include reading private messages between a landlord and tenant — that
 * content is not ours to browse, and POPIA's minimality principle (s.10) means
 * collecting a power we do not need is itself a risk.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  /** Counts for the admin dashboard. One query set, no per-row work. */
  async getStats() {
    const [
      totalUsers, landlords, tenants,
      activeRooms, letRooms, draftRooms,
      totalApplications, pendingVerifications, suspendedUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'LANDLORD' } }),
      this.prisma.user.count({ where: { role: 'TENANT' } }),
      this.prisma.room.count({ where: { status: 'active' } }),
      this.prisma.room.count({ where: { status: 'let' } }),
      this.prisma.room.count({ where: { status: 'draft' } }),
      this.prisma.application.count(),
      this.prisma.verificationRequest.count({ where: { status: 'pending' } }),
      this.prisma.user.count({ where: { isActive: false } }),
    ]);

    return {
      users: { total: totalUsers, landlords, tenants, suspended: suspendedUsers },
      rooms: { active: activeRooms, let: letRooms, draft: draftRooms },
      applications: { total: totalApplications },
      moderation: { pendingVerifications },
    };
  }

  /**
   * User search for support work — "a landlord emailed about their account".
   * Returns no password hash and no message content.
   */
  async findUsers(query?: string, role?: string, limit = 50) {
    return this.prisma.user.findMany({
      where: {
        ...(role ? { role: role as any } : {}),
        ...(query
          ? {
              OR: [
                { email: { contains: query, mode: 'insensitive' as const } },
                { fullName: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, isVerified: true, createdAt: true, lastLoginAt: true,
        landlordProfile: { select: { idVerified: true, rating: true } },
        _count: { select: { rooms: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /**
   * Everything about one account, in one call.
   *
   * Built for the support case: someone emails, and you need their history
   * without running six queries. Deliberately excludes message CONTENT — the
   * counts and who they spoke to are enough to resolve a dispute, and reading
   * private conversations is a power we do not need (POPIA s.10).
   */
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true, phone: true, role: true,
        isActive: true, isVerified: true, marketingEmails: true,
        authProvider: true, createdAt: true, lastLoginAt: true,
        landlordProfile: { select: { idVerified: true, rating: true, ratingCount: true, planTier: true } },
        tenantProfile: { select: { employmentStatus: true, incomeVerified: true, idVerified: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const isLandlord = user.role === 'LANDLORD';

    const [
      rooms, applications, tenancies, reviewsReceived,
      reportsAgainst, reportsFiled, payments, verifications,
      messageCount, savedSearches,
    ] = await Promise.all([
      isLandlord
        ? this.prisma.room.findMany({
            where: { landlordId: userId },
            select: {
              id: true, title: true, status: true, rentCents: true, locationDisplay: true,
              publishedAt: true, viewCount: true, applicationCount: true, relistCount: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),

      !isLandlord
        ? this.prisma.application.findMany({
            where: { tenantId: userId },
            select: {
              id: true, status: true, createdAt: true, archivedAt: true,
              room: { select: { id: true, title: true, locationDisplay: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),

      this.prisma.tenancy.findMany({
        where: isLandlord ? { landlordId: userId } : { tenantId: userId },
        select: {
          id: true, status: true, startDate: true, endDate: true, rentCents: true,
          room: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),

      this.prisma.review.findMany({
        where: { subjectId: userId, publishedAt: { not: null } },
        select: { id: true, type: true, rating: true, comment: true, isHidden: true, publishedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: 20,
      }),

      // The signal that matters most for moderation: has anyone reported them?
      this.prisma.report.count({ where: { reportedUserId: userId } }),
      this.prisma.report.count({ where: { reporterId: userId } }),

      this.prisma.payment.findMany({
        where: { userId },
        select: { id: true, purpose: true, amountCents: true, status: true, paidAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),

      this.prisma.verificationRequest.findMany({
        where: { userId },
        select: { id: true, type: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true },
        orderBy: { createdAt: 'desc' },
      }),

      // Count only — the conversation itself is not ours to read.
      this.prisma.message.count({ where: { senderId: userId } }),

      this.prisma.savedSearch.count({ where: { tenantId: userId } }),
    ]);

    const roomsReported = isLandlord
      ? await this.prisma.report.count({ where: { room: { landlordId: userId } } })
      : 0;

    return {
      user,
      activity: {
        messagesSent: messageCount,
        savedSearches,
        reportsFiled,
        reportsAgainst: reportsAgainst + roomsReported,
      },
      rooms,
      applications,
      tenancies,
      reviewsReceived,
      payments,
      verifications,
    };
  }

  /**
   * Suspend or restore an account.
   *
   * Suspension is reversible and does not delete anything: a suspended
   * landlord's rooms come off the board but their applications and messages
   * survive, because tenants may still need that history in a dispute.
   */
  async setUserActive(userId: string, isActive: boolean, adminId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') {
      throw new BadRequestException('Admin accounts cannot be suspended from here — use the database directly.');
    }
    if (!isActive && !reason) {
      throw new BadRequestException('A reason is required when suspending an account.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
    });

    // A suspended landlord's listings must not stay on the public board.
    if (!isActive && user.role === 'LANDLORD') {
      await this.prisma.room.updateMany({
        where: { landlordId: userId, status: { in: ['active', 'reserved'] } },
        data: { status: 'paused' },
      });
    }

    this.logger.warn(
      `Account ${isActive ? 'restored' : 'suspended'}: ${user.email} by admin ${adminId}${reason ? ` — ${reason}` : ''}`,
    );

    return { id: updated.id, email: updated.email, isActive: updated.isActive };
  }

  /**
   * Recently reported or newly published rooms, for a moderation sweep.
   * There is no report button yet, so this is newest-first for now.
   */
  async recentRooms(limit = 30) {
    return this.prisma.room.findMany({
      where: { status: { in: ['active', 'reserved'] } },
      select: {
        id: true, title: true, status: true, rentCents: true,
        locationDisplay: true, province: true, publishedAt: true,
        viewCount: true, applicationCount: true,
        landlord: { select: { id: true, fullName: true, email: true, isActive: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }
}
