import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** How long after a tenancy ends both parties may still review. */
const REVIEW_WINDOW_DAYS = 30;

/**
 * Tenancies — the record of a letting that actually happened.
 *
 * The lifecycle is deliberately confirmed rather than automatic:
 *
 *   accepted application -> pending -> active -> ended
 *                              \-> cancelled
 *
 * A tenancy is created as `pending` when a landlord accepts, but only becomes
 * `active` when someone confirms the move-in happened. Accepted applications
 * fall through often — the tenant finds somewhere else, the landlord changes
 * their mind — and a tenancy nobody confirms must not produce a review prompt
 * or feed a rating.
 */
@Injectable()
export class TenanciesService {
  private readonly logger = new Logger(TenanciesService.name);

  constructor(private prisma: PrismaService) {}

  /** Called from the accept flow. Idempotent: accepting twice creates one tenancy. */
  async createFromApplication(applicationId: string) {
    const application = await this.prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { room: true },
    });

    const existing = await this.prisma.tenancy.findUnique({ where: { applicationId } });
    if (existing) return existing;

    const tenancy = await this.prisma.tenancy.create({
      data: {
        applicationId,
        roomId: application.roomId,
        landlordId: application.room.landlordId,
        tenantId: application.tenantId,
        // Snapshot the rent: the room's rent changes on relist, and a review
        // should reflect what this tenant actually paid.
        rentCents: application.room.rentCents,
        status: 'pending',
      },
    });

    this.logger.log(`Tenancy ${tenancy.id} opened for application ${applicationId}`);
    return tenancy;
  }

  /** Either party's tenancies, newest first. */
  listMine(userId: string) {
    return this.prisma.tenancy.findMany({
      where: { OR: [{ landlordId: userId }, { tenantId: userId }] },
      include: {
        room: { select: { id: true, title: true, locationDisplay: true, heroImagePath: true } },
        landlord: { select: { id: true, fullName: true } },
        tenant: { select: { id: true, fullName: true } },
        reviews: { select: { id: true, authorId: true, type: true, publishedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Confirm the move-in happened. Either party may confirm — requiring both
   * would leave tenancies stuck whenever one side simply never logs in again.
   */
  async confirmStart(id: string, userId: string, startDate?: string) {
    const tenancy = await this.assertParty(id, userId);
    if (tenancy.status !== 'pending') {
      throw new BadRequestException(`This tenancy is already ${tenancy.status}`);
    }

    const start = startDate ? new Date(startDate) : new Date();
    if (start.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('A move-in date cannot be in the future. Confirm once the tenant has moved in.');
    }

    return this.prisma.tenancy.update({
      where: { id },
      data: { status: 'active', startDate: start },
    });
  }

  /** The letting fell through before move-in. Never produces reviews. */
  async cancel(id: string, userId: string, reason?: string) {
    const tenancy = await this.assertParty(id, userId);
    if (tenancy.status !== 'pending') {
      throw new BadRequestException('Only a tenancy that has not started can be cancelled. End it instead.');
    }

    return this.prisma.tenancy.update({
      where: { id },
      data: { status: 'cancelled', endedById: userId, endReason: reason, endDate: new Date() },
    });
  }

  /**
   * End an active tenancy. This is what opens reviews.
   *
   * Either party may end it: this records a fact, not a mutual decision, and
   * requiring agreement would let one side block the other from ever reviewing.
   */
  async end(id: string, userId: string, reason?: string, endDate?: string) {
    const tenancy = await this.assertParty(id, userId);
    if (tenancy.status === 'ended') throw new BadRequestException('This tenancy has already ended');
    if (tenancy.status !== 'active') {
      throw new BadRequestException('Only an active tenancy can be ended. Cancel it if the tenant never moved in.');
    }

    const ended = endDate ? new Date(endDate) : new Date();
    if (tenancy.startDate && ended < tenancy.startDate) {
      throw new BadRequestException('The end date cannot be before the start date.');
    }

    const updated = await this.prisma.tenancy.update({
      where: { id },
      data: {
        status: 'ended',
        endDate: ended,
        endedById: userId,
        endReason: reason,
        reviewsCloseAt: new Date(Date.now() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    this.logger.log(`Tenancy ${id} ended by ${userId}; reviews open for ${REVIEW_WINDOW_DAYS} days`);
    return updated;
  }

  /**
   * What this user may still review, and what they are waiting on.
   * Drives the dashboard prompt after a tenancy ends.
   */
  async reviewableFor(userId: string) {
    const tenancies = await this.prisma.tenancy.findMany({
      where: {
        status: 'ended',
        reviewsCloseAt: { gt: new Date() },
        OR: [{ landlordId: userId }, { tenantId: userId }],
      },
      include: {
        room: { select: { id: true, title: true, locationDisplay: true } },
        landlord: { select: { id: true, fullName: true } },
        tenant: { select: { id: true, fullName: true } },
        reviews: { select: { authorId: true, type: true } },
      },
    });

    return tenancies.map((t) => {
      const isLandlord = t.landlordId === userId;
      const mine = t.reviews.filter((r) => r.authorId === userId).map((r) => r.type);
      // A tenant reviews the room and the landlord; a landlord reviews the tenant.
      const owed = isLandlord
        ? (['tenant'] as const).filter((type) => !mine.includes(type))
        : (['room', 'landlord'] as const).filter((type) => !mine.includes(type));

      return {
        tenancy: t,
        role: isLandlord ? 'landlord' : 'tenant',
        outstanding: owed,
        closesAt: t.reviewsCloseAt,
      };
    });
  }

  private async assertParty(id: string, userId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({ where: { id } });
    if (!tenancy) throw new NotFoundException('Tenancy not found');
    if (tenancy.landlordId !== userId && tenancy.tenantId !== userId) {
      throw new ForbiddenException('You are not part of this tenancy');
    }
    return tenancy;
  }
}
