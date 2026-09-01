import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * A user's own code, created on first request.
   *
   * Derived from their name plus randomness so it is speakable over the phone
   * — "SARAH-4K2P" survives being read out in a way a UUID does not, and most
   * of these get shared by voice or WhatsApp rather than by link.
   */
  async getOrCreateMyCode(userId: string) {
    const existing = await this.prisma.referralCode.findFirst({
      where: { ownerId: userId, type: 'user', isActive: true },
    });
    if (existing) return existing;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });

    const prefix = user.fullName
      .split(' ')[0]
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 8) || 'RENT';

    // Retry on collision rather than assuming uniqueness.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `${prefix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const clash = await this.prisma.referralCode.findUnique({ where: { code } });
      if (clash) continue;
      return this.prisma.referralCode.create({
        data: { code, ownerId: userId, type: 'user' },
      });
    }
    throw new BadRequestException('Could not generate a code. Please try again.');
  }

  /** Public: check a code before signup, so the form can confirm it is real. */
  async validateCode(code: string) {
    const found = await this.prisma.referralCode.findUnique({
      where: { code: code.trim().toUpperCase() },
      include: { owner: { select: { fullName: true } } },
    });

    if (!found || !found.isActive) return { valid: false as const };
    if (found.expiresAt && found.expiresAt < new Date()) return { valid: false as const };
    if (found.maxUses !== null && found.useCount >= found.maxUses) return { valid: false as const };

    return {
      valid: true as const,
      // Launch codes have no owner, so say where it came from instead.
      invitedBy: found.owner?.fullName ?? (found.city ? `RentBoard ${found.city}` : 'RentBoard'),
    };
  }

  /**
   * Attach a new user to a code at registration.
   *
   * Never throws: a bad code must not stop someone signing up. It is recorded
   * as pending and qualifies later.
   */
  async recordSignup(refereeId: string, rawCode?: string) {
    if (!rawCode) return null;

    try {
      const code = await this.prisma.referralCode.findUnique({
        where: { code: rawCode.trim().toUpperCase() },
      });
      if (!code || !code.isActive) return null;
      if (code.expiresAt && code.expiresAt < new Date()) return null;
      if (code.maxUses !== null && code.useCount >= code.maxUses) return null;
      // Referring yourself is the most obvious abuse, and the cheapest to stop.
      if (code.ownerId === refereeId) return null;

      const existing = await this.prisma.referral.findUnique({ where: { refereeId } });
      if (existing) return null;   // one referral per person, ever

      const [referral] = await this.prisma.$transaction([
        this.prisma.referral.create({
          data: { codeId: code.id, referrerId: code.ownerId, refereeId },
        }),
        this.prisma.referralCode.update({
          where: { id: code.id },
          data: { useCount: { increment: 1 } },
        }),
      ]);

      this.logger.log(`Referral recorded: ${rawCode} -> user ${refereeId}`);
      return referral;
    } catch (err) {
      this.logger.error('Could not record referral', err as Error);
      return null;
    }
  }

  /**
   * Called when a referee does something that proves they are real: a landlord
   * publishing a room, a tenant submitting an application.
   *
   * Signups are not rewarded on their own — that is how referral schemes fill
   * with dormant accounts.
   */
  async qualify(refereeId: string, action: 'published_room' | 'applied') {
    try {
      const referral = await this.prisma.referral.findUnique({
        where: { refereeId },
        include: { referee: { select: { role: true } } },
      });
      if (!referral || referral.status !== 'pending') return;

      // A landlord referrer gets their verification fee covered. There is no
      // tenant reward: inventing one we cannot fund would be worse than none,
      // and the UI says so plainly rather than implying a payout.
      const reward =
        referral.referrerId && referral.referee.role === 'LANDLORD'
          ? 'free_verification'
          : 'none';

      await this.prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: reward === 'none' ? 'qualified' : 'rewarded',
          qualifyingAction: action,
          qualifiedAt: new Date(),
          reward: reward as any,
          rewardedAt: reward === 'none' ? null : new Date(),
        },
      });

      this.logger.log(`Referral qualified: ${referral.id} via ${action}, reward ${reward}`);
    } catch (err) {
      this.logger.error('Could not qualify referral', err as Error);
    }
  }

  /** A user's own referral picture: their code, who they brought, what they earned. */
  async getMyReferrals(userId: string) {
    const [code, referrals, unusedRewards] = await Promise.all([
      this.getOrCreateMyCode(userId),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        select: {
          id: true, status: true, reward: true, qualifyingAction: true,
          qualifiedAt: true, rewardUsedAt: true, createdAt: true,
          referee: { select: { fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referral.count({
        where: { referrerId: userId, reward: 'free_verification', rewardUsedAt: null },
      }),
    ]);

    return {
      code: code.code,
      referrals,
      summary: {
        total: referrals.length,
        pending: referrals.filter((r) => r.status === 'pending').length,
        qualified: referrals.filter((r) => r.status === 'qualified' || r.status === 'rewarded').length,
        freeVerificationsAvailable: unusedRewards,
      },
    };
  }

  /** Spends one free-verification reward. Returns false when there is none. */
  async consumeFreeVerification(userId: string): Promise<boolean> {
    const reward = await this.prisma.referral.findFirst({
      where: { referrerId: userId, reward: 'free_verification', rewardUsedAt: null },
      orderBy: { qualifiedAt: 'asc' },
    });
    if (!reward) return false;

    await this.prisma.referral.update({
      where: { id: reward.id },
      data: { rewardUsedAt: new Date() },
    });
    return true;
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async getStats() {
    const [total, pending, qualified, rewarded, byCity, topReferrers, launchCodes] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: 'pending' } }),
      this.prisma.referral.count({ where: { status: 'qualified' } }),
      this.prisma.referral.count({ where: { status: 'rewarded' } }),
      this.prisma.referralCode.groupBy({
        by: ['city'],
        where: { type: 'launch' },
        _sum: { useCount: true },
        _count: { id: true },
      }),
      this.prisma.referral.groupBy({
        by: ['referrerId'],
        where: { referrerId: { not: null }, status: { in: ['qualified', 'rewarded'] } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.referralCode.count({ where: { type: 'launch', isActive: true } }),
    ]);

    return {
      total,
      pending,
      qualified: qualified + rewarded,
      // The number that matters: signups that never became anything.
      conversionPct: total > 0 ? Math.round(((qualified + rewarded) / total) * 100) : 0,
      launchCodes,
      byCity: byCity.map((c) => ({
        city: c.city ?? 'Unspecified',
        codes: c._count.id,
        redemptions: c._sum.useCount ?? 0,
      })),
      topReferrers,
    };
  }

  listLaunchCodes(city?: string) {
    return this.prisma.referralCode.findMany({
      where: { type: 'launch', ...(city ? { city } : {}) },
      orderBy: [{ city: 'asc' }, { code: 'asc' }],
    });
  }
}
