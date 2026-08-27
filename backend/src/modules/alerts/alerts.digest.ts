import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Daily alert digest.
 *
 * Saved searches set to `daily` were previously recorded and never sent — the
 * frequency existed in the UI but nothing acted on it. This job closes that.
 *
 * Runs at 07:00 SAST: early enough that a tenant sees new rooms before the
 * working day, late enough not to arrive overnight. Railway and most hosts run
 * UTC, so the cron is expressed in UTC (05:00) with the timezone set
 * explicitly rather than relying on the server's locale.
 */
@Injectable()
export class AlertsDigest {
  private readonly logger = new Logger(AlertsDigest.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'Africa/Johannesburg' })
  async sendDailyDigests() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const searches = await this.prisma.savedSearch.findMany({
      where: { isActive: true, frequency: 'daily', notifyEmail: true },
      include: { tenant: { select: { email: true, fullName: true } } },
    });

    if (searches.length === 0) return;

    let sent = 0;

    for (const search of searches) {
      // Re-run the search rather than storing matches: a room let overnight
      // should not appear in the morning digest as if it were available.
      const matches = await this.prisma.room.findMany({
        where: {
          status: 'active',
          publishedAt: { gte: since },
          landlordId: { not: search.tenantId },
          ...(search.province ? { province: search.province } : {}),
          ...(search.city ? { city: { equals: search.city, mode: 'insensitive' } } : {}),
          ...(search.roomType ? { roomType: search.roomType } : {}),
          ...(search.maxRentCents ? { rentCents: { lte: search.maxRentCents } } : {}),
          ...(search.minRentCents ? { rentCents: { gte: search.minRentCents } } : {}),
          ...(search.billsIncluded ? { billsIncluded: true } : {}),
          ...(search.couplesAllowed ? { couplesAllowed: true } : {}),
          ...(search.dssAccepted ? { dssAccepted: true } : {}),
          ...(search.guarantorAccepted ? { guarantorAccepted: true } : {}),
          ...(search.petsAllowed ? { petsAllowed: true } : {}),
        },
        select: { id: true, title: true, rentCents: true, locationDisplay: true },
        orderBy: { publishedAt: 'desc' },
        take: 10,
      });

      // No matches means no email. A daily "nothing today" is how people
      // learn to ignore, then unsubscribe.
      if (matches.length === 0) continue;

      try {
        await this.notifications.sendDailyDigestEmail(search.tenant.email, {
          tenantName: search.tenant.fullName,
          searchName: search.name,
          rooms: matches,
        });
        sent++;
      } catch (err) {
        this.logger.error(`Digest failed for search ${search.id}`, err as Error);
      }
    }

    await this.prisma.savedSearch.updateMany({
      where: { id: { in: searches.map((s) => s.id) } },
      data: { lastNotifiedAt: new Date() },
    });

    this.logger.log(`Daily digest: ${sent} of ${searches.length} searches had matches`);
  }
}
