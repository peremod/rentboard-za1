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
    // ⚠️ Archiving runs FIRST and on its own query. See archiveClosed for why
    // it cannot ride along with the one below.
    const archived = await this.archiveClosed();

    const due = await this.prisma.tenancy.findMany({
      where: {
        status: 'ended',
        reviewsCloseAt: { lte: new Date() },
        reviews: { some: { publishedAt: null } },
      },
      select: { id: true, landlordId: true },
    });

    // ⚠️ Returns a count even when there is nothing to do, rather than a bare
    // `return`. An operator running this after a deploy needs to see "0 and 0"
    // and know it ran; `undefined` is indistinguishable from a route that did
    // not fire.
    if (due.length === 0) return { archived, released: 0 };

    for (const tenancy of due) {
      await this.prisma.review.updateMany({
        where: { tenancyId: tenancy.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
      await this.recalculate(tenancy.landlordId);
    }

    this.logger.log(`Released held reviews for ${due.length} closed tenancies`);
    return { archived, released: due.length };
  }

  /**
   * Marks a finished letting as archived once its review window has closed.
   *
   * ── Why this is a separate query and not a field on the one above
   *
   * `releaseClosedWindows` selects `reviews: { some: { publishedAt: null } }` —
   * tenancies with something held back. Most tenancies get no reviews at all,
   * so most would never be visited, and hanging `archivedAt` off that query
   * would archive only the minority that happened to have an unpublished
   * review. A column set for some rows and not others is worse than no column:
   * every reader would have to second-guess it.
   *
   * ── What archived means
   *
   * Finished AND closed to further action. `ended` was doing two jobs — "ended
   * last week, reviews open, both parties still acting on it" and "ended in
   * 2024, read-only" — and they want different screens and permissions.
   *
   * ⚠️ `cancelled` is NOT handled here, on purpose. A letting that fell
   * through has no review window to wait for (`reviewsCloseAt` stays null, and
   * `tenancy-lifecycle-drive` asserts that), so waiting for one would leave it
   * unarchived forever. `TenanciesService.cancel` sets `archivedAt` in the same
   * update that cancels it.
   *
   * ⚠️ And this does NOT make the record read-only. A tenant may still answer
   * a rent month on an archived letting — see `RentService.dispute`, where the
   * reasoning is that the final month is the mark that matters most and it is
   * entered after they have gone.
   */
  private async archiveClosed() {
    const result = await this.prisma.tenancy.updateMany({
      where: {
        status: 'ended',
        archivedAt: null,
        reviewsCloseAt: { lte: new Date() },
      },
      data: { archivedAt: new Date() },
    });
    if (result.count) this.logger.log(`Archived ${result.count} finished tenancies`);
    return result.count;
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
