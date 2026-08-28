import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Releases held reviews once a tenancy's review window closes.
 *
 * Double-blind means a review stays hidden until both sides have submitted.
 * Without this job, one party simply never writing theirs would suppress the
 * other's permanently — which is exactly what someone expecting a bad review
 * would do.
 */
@Injectable()
export class ReviewsRelease {
  private readonly logger = new Logger(ReviewsRelease.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * *', { timeZone: 'Africa/Johannesburg' })
  async releaseClosedWindows() {
    const due = await this.prisma.tenancy.findMany({
      where: {
        status: 'ended',
        reviewsCloseAt: { lte: new Date() },
        reviews: { some: { publishedAt: null } },
      },
      select: { id: true, landlordId: true },
    });

    if (due.length === 0) return;

    for (const tenancy of due) {
      await this.prisma.review.updateMany({
        where: { tenancyId: tenancy.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
      await this.recalculate(tenancy.landlordId);
    }

    this.logger.log(`Released held reviews for ${due.length} closed tenancies`);
  }

  private async recalculate(landlordId: string) {
    const result = await this.prisma.review.aggregate({
      where: { subjectId: landlordId, type: 'landlord', publishedAt: { not: null }, isHidden: false },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.landlordProfile.updateMany({
      where: { userId: landlordId },
      data: { rating: result._avg.rating ?? null, ratingCount: result._count.rating },
    });
  }
}
