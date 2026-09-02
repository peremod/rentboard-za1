import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Monthly performance reports to advertisers.
 *
 * Sent without being asked. An advertiser paying a flat monthly rate with no
 * reporting has no way to judge renewal except gut feel, and gut feel says
 * cancel. This is the cheapest retention work available.
 */
@Injectable()
export class AdsReporting {
  private readonly logger = new Logger(AdsReporting.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** 08:00 SAST on the 1st, so it lands before the invoice conversation. */
  @Cron('0 8 1 * *', { timeZone: 'Africa/Johannesburg' })
  async sendMonthlyReports() {
    const advertisers = await this.prisma.advertiser.findMany({
      where: { isActive: true, campaigns: { some: { status: { in: ['active', 'paused'] } } } },
      include: {
        campaigns: {
          where: { status: { in: ['active', 'paused'] } },
          select: { name: true, placement: true, impressions: true, clicks: true },
        },
      },
    });

    if (advertisers.length === 0) return;

    const periodLabel = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-ZA', {
      month: 'long',
      year: 'numeric',
    });

    let sent = 0;
    for (const advertiser of advertisers) {
      try {
        await this.notifications.sendAdvertiserReport(advertiser.contactEmail, {
          companyName: advertiser.companyName,
          periodLabel,
          campaigns: advertiser.campaigns.map((c) => ({
            name: c.name,
            placement: this.placementLabel(c.placement),
            impressions: c.impressions,
            clicks: c.clicks,
            ctr: c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0.00',
          })),
        });
        sent++;
      } catch (err) {
        this.logger.error(`Report failed for ${advertiser.companyName}`, err as Error);
      }
    }

    this.logger.log(`Advertiser reports sent: ${sent} of ${advertisers.length}`);
  }

  private placementLabel(placement: string) {
    return { board_sidebar: 'Sidebar', board_inline: 'In-grid', room_detail: 'Room detail' }[placement] ?? placement;
  }
}
