import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SaveSearchDto } from './dto/save-search.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  list(tenantId: string) {
    return this.prisma.savedSearch.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(dto: SaveSearchDto, tenantId: string) {
    return this.prisma.savedSearch.create({ data: { ...dto, tenantId } });
  }

  async update(id: string, dto: Partial<SaveSearchDto>, tenantId: string) {
    await this.assertOwner(id, tenantId);
    return this.prisma.savedSearch.update({ where: { id }, data: dto });
  }

  async remove(id: string, tenantId: string) {
    await this.assertOwner(id, tenantId);
    await this.prisma.savedSearch.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * Called when a room is published or relisted.
   *
   * Matching happens in the database rather than in memory: with any real
   * number of saved searches, loading them all per publish would not hold up.
   * A null filter field means "no constraint", so each condition is written as
   * "field is null OR it matches".
   *
   * Never throws — a failure here must not prevent a room going live.
   */
  async notifyMatchingTenants(roomId: string): Promise<number> {
    try {
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (!room || room.status !== 'active') return 0;

      const matches = await this.prisma.savedSearch.findMany({
        where: {
          isActive: true,
          frequency: { not: 'off' },
          // Never alert a landlord about their own listing.
          tenantId: { not: room.landlordId },

          AND: [
            { OR: [{ province: null }, { province: room.province }] },
            { OR: [{ city: null }, { city: { equals: room.city, mode: 'insensitive' } }] },
            { OR: [{ roomType: null }, { roomType: room.roomType }] },
            { OR: [{ maxRentCents: null }, { maxRentCents: { gte: room.rentCents } }] },
            { OR: [{ minRentCents: null }, { minRentCents: { lte: room.rentCents } }] },
            // A false preference means "don't care"; only true is a requirement.
            ...(room.billsIncluded ? [] : [{ OR: [{ billsIncluded: null }, { billsIncluded: false }] }]),
            ...(room.couplesAllowed ? [] : [{ OR: [{ couplesAllowed: null }, { couplesAllowed: false }] }]),
            ...(room.dssAccepted ? [] : [{ OR: [{ dssAccepted: null }, { dssAccepted: false }] }]),
            ...(room.guarantorAccepted ? [] : [{ OR: [{ guarantorAccepted: null }, { guarantorAccepted: false }] }]),
            ...(room.petsAllowed ? [] : [{ OR: [{ petsAllowed: null }, { petsAllowed: false }] }]),
          ],
        },
        include: { tenant: { select: { email: true, fullName: true } } },
      });

      const instant = matches.filter((m) => m.frequency === 'instant');

      for (const search of instant) {
        if (!search.notifyEmail) continue;
        this.notifications
          .sendNewMatchEmail(search.tenant.email, {
            tenantName: search.tenant.fullName,
            searchName: search.name,
            roomTitle: room.title,
            roomId: room.id,
            rentCents: room.rentCents,
            locationDisplay: room.locationDisplay,
          })
          .catch(() => {});
      }

      // Daily digests are picked up by a scheduled job; recording the match
      // here means the digest does not have to re-scan every room.
      await this.prisma.savedSearch.updateMany({
        where: { id: { in: matches.map((m) => m.id) } },
        data: { matchCount: { increment: 1 }, lastNotifiedAt: new Date() },
      });

      this.logger.log(`Room ${roomId} matched ${matches.length} saved searches (${instant.length} instant)`);
      return matches.length;
    } catch (err) {
      this.logger.error(`Alert matching failed for room ${roomId}`, err as Error);
      return 0;
    }
  }

  private async assertOwner(id: string, tenantId: string) {
    const search = await this.prisma.savedSearch.findUnique({ where: { id } });
    if (!search) throw new NotFoundException('Saved search not found');
    if (search.tenantId !== tenantId) throw new ForbiddenException('This is not your saved search');
    return search;
  }
}
