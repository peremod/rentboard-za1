import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { RespondToReviewDto } from './dto/respond-to-review.dto';

/**
 * Reviews.
 *
 * Two rules shape almost everything here.
 *
 * 1. DOUBLE-BLIND. Neither party sees the other's review until both have
 *    submitted, or the 30-day window closes. If you can read someone's review
 *    of you before writing your own, ratings become a negotiation.
 *
 * 2. TENANT REVIEWS ARE REFERENCES, NOT PUBLIC RECORD. A landlord's review of
 *    a tenant is shown only to a landlord who has a live application from that
 *    person — someone with a present reason to know. It does not appear on any
 *    profile and cannot be browsed. Publishing it openly would attach a
 *    permanent, searchable judgement to an individual, which is the platform's
 *    largest defamation exposure and would follow a tenant between lettings.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateReviewDto, authorId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: dto.tenancyId },
      include: { reviews: true },
    });
    if (!tenancy) throw new NotFoundException('Tenancy not found');

    const isLandlord = tenancy.landlordId === authorId;
    const isTenant = tenancy.tenantId === authorId;
    if (!isLandlord && !isTenant) throw new ForbiddenException('You were not part of this tenancy');

    if (tenancy.status !== 'ended') {
      throw new BadRequestException('You can review once the tenancy has ended.');
    }
    if (tenancy.reviewsCloseAt && tenancy.reviewsCloseAt < new Date()) {
      throw new BadRequestException('The review window for this tenancy has closed.');
    }

    // Each side may only write the review types that belong to their role.
    const allowed = isLandlord ? ['tenant'] : ['room', 'landlord'];
    if (!allowed.includes(dto.type)) {
      throw new BadRequestException(
        isLandlord
          ? 'A landlord reviews the tenant. Room and landlord reviews are written by the tenant.'
          : 'A tenant reviews the room and the landlord.',
      );
    }

    if (tenancy.reviews.some((r) => r.authorId === authorId && r.type === dto.type)) {
      throw new BadRequestException('You have already written this review.');
    }

    const review = await this.prisma.review.create({
      data: {
        tenancyId: tenancy.id,
        authorId,
        type: dto.type,
        rating: dto.rating,
        comment: dto.comment,
        subjectId: dto.type === 'room' ? null : isLandlord ? tenancy.tenantId : tenancy.landlordId,
        roomId: dto.type === 'room' ? tenancy.roomId : null,
      },
    });

    await this.publishIfBothSidesDone(tenancy.id);
    this.logger.log(`Review ${review.id} (${dto.type}) written for tenancy ${tenancy.id}`);
    return review;
  }

  /**
   * Reveal both sides at once, once each has submitted everything they owe.
   * A scheduled job also releases whatever exists when the window closes, so a
   * silent counterparty cannot suppress a review indefinitely.
   */
  private async publishIfBothSidesDone(tenancyId: string) {
    const tenancy = await this.prisma.tenancy.findUniqueOrThrow({
      where: { id: tenancyId },
      include: { reviews: true },
    });

    const tenantDone = ['room', 'landlord'].every((type) =>
      tenancy.reviews.some((r) => r.authorId === tenancy.tenantId && r.type === type),
    );
    const landlordDone = tenancy.reviews.some(
      (r) => r.authorId === tenancy.landlordId && r.type === 'tenant',
    );

    if (!tenantDone || !landlordDone) return;

    await this.prisma.review.updateMany({
      where: { tenancyId, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    await this.recalculateLandlordRating(tenancy.landlordId);
  }

  /** Public reviews of a room, for the room detail page. */
  getRoomReviews(roomId: string) {
    return this.prisma.review.findMany({
      where: { roomId, type: 'room', publishedAt: { not: null }, isHidden: false },
      select: {
        id: true, rating: true, comment: true, publishedAt: true,
        response: true, respondedAt: true,
        author: { select: { fullName: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
  }

  /** Public reviews of a landlord. */
  getLandlordReviews(landlordId: string) {
    return this.prisma.review.findMany({
      where: { subjectId: landlordId, type: 'landlord', publishedAt: { not: null }, isHidden: false },
      select: {
        id: true, rating: true, comment: true, publishedAt: true,
        response: true, respondedAt: true,
        author: { select: { fullName: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * References for a prospective tenant — the restricted case.
   *
   * Allowed only when the viewer is the landlord of a room this person has a
   * live application on. Not browsable, not on a profile, and gone again once
   * the application is decided.
   */
  async getTenantReferences(tenantId: string, viewerId: string) {
    const hasLiveApplication = await this.prisma.application.findFirst({
      where: {
        tenantId,
        archivedAt: null,
        status: { in: ['pending', 'viewed', 'shortlisted'] },
        room: { landlordId: viewerId },
      },
      select: { id: true },
    });

    if (!hasLiveApplication) {
      throw new ForbiddenException(
        'Tenant references are only available while that person has a live application on one of your rooms.',
      );
    }

    const reviews = await this.prisma.review.findMany({
      where: { subjectId: tenantId, type: 'tenant', publishedAt: { not: null }, isHidden: false },
      select: {
        id: true, rating: true, comment: true, publishedAt: true,
        response: true, respondedAt: true,
        tenancy: { select: { startDate: true, endDate: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    this.logger.log(`Tenant references for ${tenantId} viewed by landlord ${viewerId}`);
    return {
      reviews,
      // Absence of references is not a negative signal, and saying so stops
      // landlords reading "no reviews" as "bad tenant".
      note: reviews.length === 0
        ? 'No references yet. Most tenants have none — it usually means they have not let through RentBoard before.'
        : null,
    };
  }

  /** Everything the signed-in user has written or received, published or not. */
  async getMine(userId: string) {
    const [written, received] = await Promise.all([
      this.prisma.review.findMany({
        where: { authorId: userId },
        include: { tenancy: { select: { id: true, roomId: true, endDate: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.findMany({
        where: { subjectId: userId, publishedAt: { not: null } },
        include: { tenancy: { select: { id: true, roomId: true, endDate: true } } },
        orderBy: { publishedAt: 'desc' },
      }),
    ]);
    return { written, received };
  }

  /** One reply per review, by its subject. Does not change the rating. */
  async respond(reviewId: string, dto: RespondToReviewDto, userId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.subjectId !== userId) {
      throw new ForbiddenException('Only the person reviewed can respond to it');
    }
    if (!review.publishedAt) {
      throw new BadRequestException('This review is not published yet.');
    }
    if (review.response) {
      throw new BadRequestException('You have already responded to this review.');
    }

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { response: dto.response, respondedAt: new Date() },
    });
  }

  /** Landlord rating is the mean of published, unhidden landlord reviews. */
  private async recalculateLandlordRating(landlordId: string) {
    const result = await this.prisma.review.aggregate({
      where: { subjectId: landlordId, type: 'landlord', publishedAt: { not: null }, isHidden: false },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.landlordProfile.updateMany({
      where: { userId: landlordId },
      data: {
        rating: result._avg.rating ?? null,
        ratingCount: result._count.rating,
      },
    });
  }

  /** Admin moderation — the defamation path. Hiding recalculates the rating. */
  async setHidden(reviewId: string, isHidden: boolean, reason: string | undefined, adminId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    if (isHidden && !reason) {
      throw new BadRequestException('A reason is required when hiding a review.');
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { isHidden, hiddenReason: reason },
    });

    if (review.type === 'landlord' && review.subjectId) {
      await this.recalculateLandlordRating(review.subjectId);
    }

    this.logger.warn(`Review ${reviewId} ${isHidden ? 'hidden' : 'restored'} by admin ${adminId}`);
    return updated;
  }
}
