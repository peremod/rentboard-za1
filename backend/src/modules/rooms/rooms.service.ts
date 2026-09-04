import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RoomFiltersDto } from './dto/room-filters.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RelistDto } from './dto/relist.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/**
 * Billing is temporarily disabled (see StripeModule — commented out of
 * AppModule) — every landlord is effectively on an unlimited free tier
 * for now. FREE_PLAN_ROOM_LIMIT / enforcePlanLimit() are kept in the file,
 * just unused, so re-enabling billing later is a small, obvious diff
 * rather than reconstructing this from scratch. See PRE-LAUNCH-CHECKLIST.md.
 */
// const FREE_PLAN_ROOM_LIMIT = 2;

/** Max photos per room while on the (temporary, unlimited) free tier. */
const MAX_PHOTOS_PER_ROOM = 20;
/** Landlord can undo a mark-as-let within this window. */
const UNDO_LET_WINDOW_MINUTES = 30;

@Injectable()
export class RoomsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private alerts: AlertsService,
    private referrals: ReferralsService,
  ) {}

  /** Public notice-board search — only ever returns status = 'active' rooms. */
  async findAll(filters: RoomFiltersDto) {
    const {
      search, roomType, province, city, maxRentCents, minRentCents,
      billsIncluded, couplesAllowed, dssAccepted, guarantorAccepted, petsAllowed,
      sortBy = 'newest', page = 1, limit = 12,
    } = filters;

    const where: any = {
      status: 'active',
      ...(roomType && { roomType }),
      ...(province && { province }),
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(billsIncluded && { billsIncluded: true }),
      ...(couplesAllowed && { couplesAllowed: true }),
      ...(dssAccepted && { dssAccepted: true }),
      ...(guarantorAccepted && { guarantorAccepted: true }),
      ...(petsAllowed && { petsAllowed: true }),
      ...(maxRentCents && { rentCents: { lte: maxRentCents } }),
      ...(minRentCents && { rentCents: { gte: minRentCents } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { locationDisplay: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy: any[] = [
      { isFeatured: 'desc' },
      ...(sortBy === 'price_asc' ? [{ rentCents: 'asc' }] : []),
      ...(sortBy === 'price_desc' ? [{ rentCents: 'desc' }] : []),
      ...(sortBy === 'newest' || sortBy === 'featured' ? [{ publishedAt: 'desc' }] : []),
    ];

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        // The room card shows the landlord's name, avatar and rating, so the
        // relation is loaded here rather than fetched per card by the client.
      include: {
        landlord: {
          select: {
            id: true,
            fullName: true,
            avatarPath: true,
            landlordProfile: { select: { rating: true, ratingCount: true, idVerified: true } },
          },
        },
      },
      }),
      this.prisma.room.count({ where }),
    ]);

    return { data, total, page, limit, hasMore: skip + data.length < total };
  }

  /**
   * @param viewerId  when the viewer is the owner, the view is not counted —
   *                  a landlord checking their own listing should not inflate
   *                  the number they use to judge how it is performing.
   */
  async findOne(id: string, viewerId?: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException(`Room ${id} not found`);

    const isOwner = viewerId === room.landlordId;

    // A removed listing must not be retrievable by id. It was still returning
    // 200 to anyone holding the id, so a tenant's saved room kept rendering
    // normally after the landlord took it down. Owners keep access, because
    // they can relist it.
    if (room.status === 'deleted' && !isOwner) {
      throw new NotFoundException(`Room ${id} not found`);
    }

    // A draft has never been public.
    if (room.status === 'draft' && !isOwner) {
      throw new NotFoundException(`Room ${id} not found`);
    }

    if (!isOwner) {
      this.prisma.room.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
    }
    return room;
  }

  async create(dto: CreateRoomDto, landlordId: string) {
    // Billing paused — no per-landlord room-count limit while on the
    // temporary unlimited free tier. See file header comment.
    return this.prisma.room.create({
      data: {
        ...dto,
        title: sanitizeText(dto.title),
        description: dto.description ? sanitizeText(dto.description) : dto.description,
        availableFrom: new Date(dto.availableFrom),
        landlordId,
        status: 'draft',
      },
    });
  }

  async update(id: string, dto: UpdateRoomDto, landlordId: string) {
    const before = await this.assertOwner(id, landlordId);
    this.assertPhotoLimit(dto.imagePaths);

    // Someone with an open application has effectively made an offer at the
    // old rent. Changing it silently means they could be accepted into a
    // tenancy they never agreed to.
    if (
      dto.rentCents !== undefined &&
      dto.rentCents !== before.rentCents &&
      before.status === 'active'
    ) {
      this.notifyRentChange(id, before.rentCents, dto.rentCents).catch(() => {});
    }

    return this.prisma.room.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.title && { title: sanitizeText(dto.title) }),
        ...(dto.description && { description: sanitizeText(dto.description) }),
        ...(dto.availableFrom && { availableFrom: new Date(dto.availableFrom) }),
      },
    });
  }

  /** Photo cap — the free tier's stated limit is 20 photos per room. Defense in depth alongside the frontend's own cap in PhotoUpload. */
  private assertPhotoLimit(imagePaths: string[] | undefined) {
    if (imagePaths && imagePaths.length > MAX_PHOTOS_PER_ROOM - 1) {
      // -1 because heroImagePath is stored separately from imagePaths (the
      // gallery) — together they must not exceed MAX_PHOTOS_PER_ROOM.
      throw new BadRequestException(`A room can have at most ${MAX_PHOTOS_PER_ROOM} photos (1 cover + ${MAX_PHOTOS_PER_ROOM - 1} gallery).`);
    }
  }

  /** Publish a draft — requires a cover photo and a real description first. */
  async publish(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (!room.heroImagePath) throw new BadRequestException('A cover photo is required before publishing');
    if (!room.description || room.description.length < 50) {
      throw new BadRequestException('Description must be at least 50 characters');
    }
    const published = await this.prisma.room.update({
      where: { id },
      data: { status: 'active', publishedAt: new Date() },
    });

    // Fire-and-forget: alerting tenants must never block or fail a publish.
    this.alerts.notifyMatchingTenants(id).catch(() => {});

    // Publishing is what makes a referred landlord worth referring — a signup
    // alone proves nothing.
    this.referrals.qualify(room.landlordId, 'published_room').catch(() => {});

    return published;
  }

  /**
   * Reserved: a tenant is lined up but nothing is signed.
   *
   * The room stays visible so the landlord keeps a fallback if the deal falls
   * through, but it no longer accepts new applications and the board shows a
   * Reserved badge. Existing applicants are left open deliberately — that is
   * the fallback.
   */
  async markReserved(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'active') {
      throw new BadRequestException(`Only an active room can be reserved (this one is ${room.status})`);
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'reserved' } });
  }

  /**
   * Resume a paused listing.
   *
   * Deliberately NOT relist. Relisting archives every open application and
   * starts a new cycle, which is right when a tenancy has ended — and exactly
   * wrong here, since the whole point of pausing is that applications survive.
   */
  async unpause(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'paused') {
      throw new BadRequestException('This room is not paused');
    }
    return this.prisma.room.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  /** Reserved → active, when a prospective tenant falls through. */
  async unreserve(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'reserved') {
      throw new BadRequestException('This room is not reserved');
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'active' } });
  }

  /**
   * Pause: off the board temporarily, without closing anyone's application.
   *
   * Previously a landlord who needed to stop enquiries for a week had only
   * 'mark as let', which closes and emails every applicant — a destructive
   * action used for a non-destructive reason.
   */
  async pause(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'active' && room.status !== 'reserved') {
      throw new BadRequestException(`Cannot pause a ${room.status} room`);
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'paused' } });
  }

  /**
   * Soft-delete a published room. Kept as a row rather than removed because
   * applications and messages reference it, and the privacy policy commits to
   * retaining application records for 2 years after outcome.
   */
  async softDelete(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status === 'draft') {
      throw new BadRequestException('Use discard for drafts — they are removed outright');
    }

    const stillOpen = await this.prisma.application.findMany({
      where: { roomId: id, cycle: room.relistCount, archivedAt: null, status: { in: ['pending', 'viewed', 'shortlisted'] } },
      include: { tenant: { select: { email: true, fullName: true } } },
    });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.application.updateMany({
        where: { id: { in: stillOpen.map((a) => a.id) } },
        data: { status: 'rejected', decidedAt: new Date(), archivedAt: new Date() },
      }),
      this.prisma.room.update({ where: { id }, data: { status: 'deleted' } }),
    ]);

    this.notifySavers(id, 'removed').catch(() => {});

    for (const application of stillOpen) {
      this.notifications
        .sendRoomUnavailableEmail(application.tenant.email, {
          tenantName: application.tenant.fullName,
          roomTitle: room.title,
        })
        .catch(() => {});
    }

    return updated;
  }

  /** Removes the room from the public board and archives it for the landlord. */
  async markLet(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'active' && room.status !== 'reserved') {
      throw new BadRequestException(`Cannot mark a ${room.status} room as let`);
    }
    // Close out everyone still waiting. Without this their applications stay
    // 'pending' forever on a room that is no longer available — the tenant is
    // left refreshing a dashboard for a decision that will never come.
    const stillOpen = await this.prisma.application.findMany({
      where: {
        roomId: id,
        cycle: room.relistCount,
        archivedAt: null,
        status: { in: ['pending', 'viewed', 'shortlisted'] },
      },
      include: { tenant: { select: { email: true, fullName: true } } },
    });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.application.updateMany({
        where: { id: { in: stillOpen.map((a) => a.id) } },
        data: { status: 'rejected', decidedAt: new Date(), archivedAt: new Date() },
      }),
      this.prisma.room.update({ where: { id }, data: { status: 'let', letAt: new Date() } }),
    ]);

    this.notifySavers(id, 'let').catch(() => {});

    // Best-effort: a failed email must not roll back the letting.
    for (const application of stillOpen) {
      this.notifications
        .sendRoomUnavailableEmail(application.tenant.email, {
          tenantName: application.tenant.fullName,
          roomTitle: room.title,
        })
        .catch(() => {});
    }

    return updated;
  }

  /** 30-minute undo window after markLet(). */
  async undoLet(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'let') throw new BadRequestException('This room has not been marked as let');

    const minutesSince = (Date.now() - (room.letAt?.getTime() ?? 0)) / 60000;
    if (minutesSince > UNDO_LET_WINDOW_MINUTES) {
      throw new BadRequestException(`Undo window has expired (${UNDO_LET_WINDOW_MINUTES} min). Please relist instead.`);
    }
    return this.prisma.room.update({ where: { id }, data: { status: 'active', letAt: null } });
  }

  /** One-click relist — restores an archived room to active, preserving all details. */
  async relist(id: string, dto: RelistDto, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (!['let', 'paused', 'deleted'].includes(room.status)) {
      throw new BadRequestException('Only let, paused or removed rooms can be relisted');
    }
    // Billing paused — no plan-limit check here either. See file header comment.

    // Close out the previous cycle before starting a new one. Without this the
    // old applicants reappear on the dashboard as if they were new, and an
    // already-accepted application keeps the room looking let.
    const [, updated] = await this.prisma.$transaction([
      this.prisma.application.updateMany({
        where: { roomId: id, archivedAt: null },
        data: { archivedAt: new Date() },
      }),
      this.prisma.room.update({
        where: { id },
        data: {
          status: 'active',
          rentCents: dto.rentCents ?? room.rentCents,
          availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : room.availableFrom,
          publishedAt: new Date(),
          letAt: null,
          relistCount: { increment: 1 },
          // Counter tracks the current cycle, matching the applicant list.
          applicationCount: 0,
        },
      }),
    ]);

    // A relisted room is new to anyone who was not watching last time.
    this.alerts.notifyMatchingTenants(id).catch(() => {});

    return updated;
  }

  /**
   * Everything the landlord is still working on.
   *
   * 'paused' belongs here rather than in archived: the room is off the board
   * but not finished with. It was in neither query, so pausing a listing made
   * it vanish from the dashboard entirely and there was no way to resume it.
   */
  getLandlordRooms(landlordId: string) {
    return this.prisma.room.findMany({
      where: { landlordId, status: { in: ['active', 'reserved', 'paused', 'draft'] } },
      orderBy: { publishedAt: 'desc' },
    });
  }

  /**
   * Finished with, but relistable: let, or removed. A removed listing was
   * previously unreachable from anywhere in the dashboard.
   */
  getArchivedRooms(landlordId: string) {
    return this.prisma.room.findMany({
      where: { landlordId, status: { in: ['let', 'deleted'] } },
      // updatedAt rather than letAt, which is null on a removed room and would
      // sort those to the end regardless of when they were removed.
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
  }

  /**
   * Permanently removes a draft. Only drafts can be discarded: a room that has
   * ever been published may have applications and messages attached to it, so
   * those are archived via markLet instead of deleted.
   */
  async discardDraft(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status !== 'draft') {
      throw new BadRequestException(
        'Only drafts can be discarded. Published rooms should be marked as let so their applications are preserved.',
      );
    }
    await this.prisma.room.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * Replaces a room's gallery. The first path is the cover image.
   *
   * Works on active listings, not just drafts — a landlord needs to swap a
   * poor photo or add one without taking the room off the board. Publishing
   * requires a cover image, so an active room may not be left with none.
   */
  async updatePhotos(id: string, paths: string[], landlordId: string) {
    const room = await this.assertOwner(id, landlordId);

    if (room.status !== 'draft' && paths.length === 0) {
      throw new BadRequestException(
        'A published room must keep at least one photo. Mark it as let if you want it off the board.',
      );
    }

    return this.prisma.room.update({
      where: { id },
      data: {
        heroImagePath: paths[0] ?? null,
        imagePaths: paths.slice(1),
      },
    });
  }

  /**
   * Location suggestions for the search box.
   *
   * Drawn from cities that actually have live listings, not a static gazetteer:
   * suggesting "Bloemfontein" when nothing is let there sends people to an
   * empty result and teaches them the search is useless. Counts are returned
   * so the UI can say how many rooms are waiting.
   */
  async suggestLocations(query: string, limit = 8) {
    const term = query.trim();
    if (term.length < 2) return [];

    const rows = await this.prisma.room.groupBy({
      by: ['city', 'province'],
      where: {
        status: 'active',
        OR: [
          { city: { contains: term, mode: 'insensitive' } },
          { province: { contains: term, mode: 'insensitive' } },
          { locationDisplay: { contains: term, mode: 'insensitive' } },
        ],
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return rows.map((r) => ({
      city: r.city,
      province: r.province,
      label: `${r.city}, ${r.province}`,
      roomCount: r._count.id,
    }));
  }

  /**
   * Tells everyone who saved a room that it is gone.
   *
   * They never applied, so no other notification reaches them — the room just
   * stops existing. notifiedUnavailableAt guards against sending twice if a
   * landlord lets, undoes, and lets again.
   */
  /** Tells open applicants the rent moved, and that they may withdraw. */
  private async notifyRentChange(roomId: string, oldRentCents: number, newRentCents: number) {
    try {
      const room = await this.prisma.room.findUniqueOrThrow({
        where: { id: roomId },
        select: { title: true, relistCount: true },
      });

      const open = await this.prisma.application.findMany({
        where: {
          roomId,
          cycle: room.relistCount,
          archivedAt: null,
          status: { in: ['pending', 'viewed', 'shortlisted'] },
        },
        include: { tenant: { select: { email: true, fullName: true } } },
      });
      if (open.length === 0) return;

      for (const application of open) {
        this.notifications
          .sendRentChangedEmail(application.tenant.email, {
            tenantName: application.tenant.fullName,
            roomTitle: room.title,
            roomId,
            oldRentCents,
            newRentCents,
          })
          .catch(() => {});
      }

      this.logger.log(
        `Rent on ${roomId} changed ${oldRentCents} -> ${newRentCents}; told ${open.length} applicant(s)`,
      );
    } catch (err) {
      this.logger.error(`Could not notify rent change for ${roomId}`, err as Error);
    }
  }

  private async notifySavers(roomId: string, reason: 'let' | 'removed') {
    try {
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        select: { title: true, locationDisplay: true },
      });
      if (!room) return;

      const saves = await this.prisma.savedRoom.findMany({
        where: { roomId, notifiedUnavailableAt: null },
        include: { tenant: { select: { email: true, fullName: true } } },
      });
      if (saves.length === 0) return;

      await this.prisma.savedRoom.updateMany({
        where: { id: { in: saves.map((s) => s.id) } },
        data: { notifiedUnavailableAt: new Date() },
      });

      for (const save of saves) {
        this.notifications
          .sendSavedRoomGoneEmail(save.tenant.email, {
            tenantName: save.tenant.fullName,
            roomTitle: room.title,
            locationDisplay: room.locationDisplay,
            reason,
          })
          .catch(() => {});
      }

      this.logger.log(`Told ${saves.length} saver(s) that room ${roomId} is ${reason}`);
    } catch (err) {
      this.logger.error(`Could not notify savers for room ${roomId}`, err as Error);
    }
  }

  private async assertOwner(roomId: string, landlordId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.landlordId !== landlordId) throw new ForbiddenException('You do not have permission to modify this room');
    return room;
  }

  // Kept for when billing is re-enabled — see file header comment and
  // PRE-LAUNCH-CHECKLIST.md. Re-enabling: uncomment this, uncomment
  // FREE_PLAN_ROOM_LIMIT above, and restore the two call sites in
  // create() and relist().
  //
  // private async enforcePlanLimit(landlordId: string) {
  //   const profile = await this.prisma.landlordProfile.findUnique({ where: { userId: landlordId } });
  //   if (profile?.planTier !== 'free') return;
  //
  //   const count = await this.prisma.room.count({
  //     where: { landlordId, status: { in: ['active', 'draft', 'reserved'] } },
  //   });
  //   if (count >= FREE_PLAN_ROOM_LIMIT) {
  //     throw new ForbiddenException(
  //       `Free plan allows up to ${FREE_PLAN_ROOM_LIMIT} active rooms. Upgrade to Pro for unlimited listings.`,
  //     );
  //   }
  // }
}
