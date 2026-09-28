import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto, AssignRoomsDto } from './dto/property.dto';
import { RoomsService } from '../rooms/rooms.service';

/**
 * Yards — several rooms at one place, under one landlord.
 *
 * The product has been modelling a six-room yard as six unrelated listings,
 * which is why a landlord could not ask the two questions they actually have:
 * how many of my rooms are empty, and who has applied anywhere on this
 * property. Both competitors have the same gap.
 *
 * Grouping is optional throughout. A landlord with one room is never made to
 * create a container for it, and every room that existed before this has no
 * property and behaves exactly as it did.
 */
@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private prisma: PrismaService,
    /** Relist lives in RoomsService and is called, never reimplemented — see relistAll. */
    private rooms: RoomsService,
  ) {}

  private async assertOwned(propertyId: string, landlordId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('No such property');
    if (property.landlordId !== landlordId) throw new ForbiddenException('That is not your property');
    return property;
  }

  create(dto: CreatePropertyDto, landlordId: string) {
    return this.prisma.property.create({ data: { ...dto, landlordId } });
  }

  async update(id: string, dto: UpdatePropertyDto, landlordId: string) {
    await this.assertOwned(id, landlordId);
    return this.prisma.property.update({ where: { id }, data: dto });
  }


  /**
   * Relist every room in a yard that can be relisted.
   *
   * The bulk action a multi-room landlord actually has: a yard empties at the
   * end of a month and putting six rooms back on the board is six trips
   * through the dashboard.
   *
   * ── Two decisions worth stating
   *
   * It calls RoomsService.relist per room rather than writing its own
   * updateMany. Relisting is not one field: it archives the previous cycle's
   * applications, increments relistCount so the applicant list matches the
   * cycle, resets applicationCount, clears letAt and notifies matching
   * tenants. A faster bulk version would be a second copy of that rule, and
   * the copy is always the one that misses the next fix — this repository has
   * paid for that lesson repeatedly.
   *
   * It SKIPS rooms that cannot be relisted instead of failing the call. An
   * active room in the same yard is not an error, it is the normal case: a
   * landlord with four let rooms and two live ones means "put the four back",
   * and refusing the whole thing because two are already listed would make the
   * button useless exactly when it is most wanted. Every skip is named and
   * returned, so the result says what happened rather than only how much.
   */
  async relistAll(propertyId: string, landlordId: string) {
    await this.assertOwned(propertyId, landlordId);

    const rooms = await this.prisma.room.findMany({
      where: { propertyId, landlordId },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const relisted: { id: string; title: string }[] = [];
    const skipped: { id: string; title: string; reason: string }[] = [];

    for (const room of rooms) {
      if (!['let', 'paused', 'deleted'].includes(room.status)) {
        skipped.push({
          id: room.id,
          title: room.title,
          reason: room.status === 'active' ? 'already on the board' : `cannot be relisted while ${room.status}`,
        });
        continue;
      }
      try {
        await this.rooms.relist(room.id, {}, landlordId);
        relisted.push({ id: room.id, title: room.title });
      } catch (err) {
        // One room failing must not take the other five with it. The reason is
        // carried back rather than logged and swallowed.
        skipped.push({
          id: room.id,
          title: room.title,
          reason: err instanceof Error ? err.message : 'could not be relisted',
        });
      }
    }

    this.logger.log(`Property ${propertyId}: relisted ${relisted.length}, skipped ${skipped.length}`);
    return { relisted, skipped };
  }

  /**
   * Deleting a yard does not delete its rooms.
   *
   * `onDelete: SetNull` on the relation, and that is the whole point: a yard
   * is a way of grouping listings, not a thing the listings belong to. A
   * landlord tidying up their dashboard must not be able to destroy six live
   * listings and their applications by removing a label.
   */
  async remove(id: string, landlordId: string) {
    await this.assertOwned(id, landlordId);
    const { count } = await this.prisma.room.updateMany({
      where: { propertyId: id },
      data: { propertyId: null },
    });
    await this.prisma.property.delete({ where: { id } });
    this.logger.log(`Property ${id} deleted; ${count} room(s) ungrouped, none removed`);
    return { deleted: true, roomsUngrouped: count };
  }

  async assignRooms(id: string, dto: AssignRoomsDto, landlordId: string) {
    await this.assertOwned(id, landlordId);

    // Every id must be the caller's. Checked as a set rather than filtered,
    // so a wrong id fails the call instead of being silently dropped — a
    // landlord who pasted the wrong room should be told, not left believing
    // it moved.
    const owned = await this.prisma.room.findMany({
      where: { id: { in: dto.roomIds }, landlordId },
      select: { id: true },
    });
    if (owned.length !== dto.roomIds.length) {
      throw new BadRequestException('One or more of those rooms is not yours.');
    }

    await this.prisma.room.updateMany({
      where: { id: { in: dto.roomIds } },
      data: { propertyId: id },
    });
    return { assigned: dto.roomIds.length };
  }

  async unassignRoom(roomId: string, landlordId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, select: { landlordId: true } });
    if (!room) throw new NotFoundException('No such room');
    if (room.landlordId !== landlordId) throw new ForbiddenException('That is not your room');
    return this.prisma.room.update({ where: { id: roomId }, data: { propertyId: null } });
  }

  /**
   * The yard dashboard: every property, every room on it, and the state of
   * each — in one query rather than one per room.
   *
   * Applicants are counted for the CURRENT letting cycle only. A room that
   * has been relisted carries archived applications from before, and counting
   * those would tell a landlord they have eleven people waiting when they
   * have two.
   *
   * Rooms with no property come back under a null group rather than being
   * dropped. A landlord who has grouped four of their six rooms must still
   * see the other two, or the dashboard quietly lies about what they own.
   */
  async dashboard(landlordId: string) {
    const [properties, rooms, profile] = await Promise.all([
      this.prisma.property.findMany({
        where: { landlordId },
        orderBy: { name: 'asc' },
      }),
      this.prisma.room.findMany({
        where: { landlordId, status: { not: 'deleted' } },
        orderBy: [{ propertyId: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true, title: true, status: true, rentCents: true,
          locationDisplay: true, heroImagePath: true, propertyId: true,
          relistCount: true, publishedAt: true, viewCount: true,
          applications: {
            where: { archivedAt: null, status: { in: ['pending', 'viewed', 'shortlisted'] } },
            select: {
              id: true, status: true, createdAt: true,
              tenant: {
                select: {
                  id: true, fullName: true,
                  tenantProfile: { select: { hasPassport: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
          tenancies: {
            where: { status: { in: ['pending', 'active'] } },
            select: {
              id: true, status: true, startDate: true, rentCents: true,
              tenant: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
      // The reminder window. PATCH /properties/rent/settings could set it
      // from the day rent tracking shipped, but nothing ever read it back, so
      // no screen could show a landlord what their own setting was — and a
      // control you cannot read the current value of is not a control.
      this.prisma.landlordProfile.findUnique({
        where: { userId: landlordId },
        select: { rentGraceDays: true },
      }),
    ]);

    // Only current-cycle applications count as waiting. `archivedAt: null`
    // above already excludes previous cycles, but a room relisted in the same
    // request window can still carry one, so the cycle is checked too.
    const group = (propertyId: string | null) => {
      const inGroup = rooms.filter((r) => r.propertyId === propertyId);
      return {
        rooms: inGroup,
        roomCount: inGroup.length,
        vacant: inGroup.filter((r) => r.status === 'active').length,
        let: inGroup.filter((r) => r.status === 'let' || r.status === 'reserved').length,
        draft: inGroup.filter((r) => r.status === 'draft').length,
        paused: inGroup.filter((r) => r.status === 'paused').length,
        waitingApplicants: inGroup.reduce((n, r) => n + r.applications.length, 0),
      };
    };

    const grouped = properties.map((property) => ({ property, ...group(property.id) }));
    const ungrouped = group(null);

    return {
      properties: grouped,
      /// Rooms the landlord has not put in a yard. Never hidden.
      ungrouped: ungrouped.roomCount > 0 ? ungrouped : null,
      totals: {
        rooms: rooms.length,
        vacant: rooms.filter((r) => r.status === 'active').length,
        waitingApplicants: rooms.reduce((n, r) => n + r.applications.length, 0),
      },
      // Days after the 1st before an unpaid month triggers a reminder; 0 is
      // off. Defaulted here to the schema's own default so a landlord with no
      // profile row still sees the number that is actually being applied.
      rentGraceDays: profile?.rentGraceDays ?? 3,
    };
  }

  list(landlordId: string) {
    return this.prisma.property.findMany({
      where: { landlordId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { rooms: true } } },
    });
  }
}
