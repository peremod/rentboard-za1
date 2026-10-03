import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { NoticeRouter } from '../notifications/notice-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RoomFiltersDto } from './dto/room-filters.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UserRole } from '@prisma/client';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RelistDto } from './dto/relist.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/**
 * There is no room limit: unlimited listings is the product, not a pause.
 * "Free to list, free to apply" is the whole position against RoomKing,
 * AmaRoom, Gumtree and Facebook, and the only charge Mastande takes is the
 * once-off R149 identity check. See /pricing and Terms §4.
 *
 * FREE_PLAN_ROOM_LIMIT / enforcePlanLimit() stay in the file, unused. They
 * described a two-room cap on a free tier below plans that were deleted along
 * with the Stripe module that was meant to sell them; reintroducing a cap
 * would be a product decision, not a matter of uncommenting this.
 */
// const FREE_PLAN_ROOM_LIMIT = 2;

/** Max photos per room while on the (temporary, unlimited) free tier. */
const MAX_PHOTOS_PER_ROOM = 20;
/** Landlord can undo a mark-as-let within this window. */
const UNDO_LET_WINDOW_MINUTES = 30;

/**
 * The only landlord fields any public room response carries: a name, an
 * avatar, the rating tenants gave them and whether their identity was
 * checked. No email, no phone, no document — POPIA s.10, and the same
 * selection for the board and the detail page so the two cannot drift.
 */
const PUBLIC_LANDLORD = {
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
} as const;

/**
 * What a tenant is told about the rest of the house, on the detail page only.
 *
 * Four fields and no more. NOT the yard's `name`: that is the landlord's own
 * label for their dashboard — "Ext 7 back rooms", "the Vilakazi place" — and
 * publishing an internal nickname beside a room is how a landlord ends up
 * surprised by their own listing. City and province are already on the room,
 * and the suburb is what the room shows publicly rather than the street, for
 * the tenant's safety.
 *
 * Detail page only, deliberately. The board returns many rooms per request and
 * house rules can run to a paragraph; nobody reads them from a card.
 */
const PUBLIC_ROOM_DETAIL = {
  include: {
    ...PUBLIC_LANDLORD.include,
    property: {
      select: {
        houseRules: true,
        sharedAmenities: true,
        currentHousemates: true,
        housemateProfile: true,
        // Phase 6. Compatibility matters most for a sublet, where somebody is
        // choosing housemates rather than only a room — but a landlord-owned
        // shared house has a household too, so these are shown wherever they
        // have been stated and nowhere they have not (`unstated` renders as
        // nothing, as `housemateProfile` already does).
        householdSchedule: true,
        householdCleanliness: true,
        householdSocial: true,
      },
    },
  },
} as const;

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private alerts: AlertsService,
    private referrals: ReferralsService,
    private notice: NoticeRouter,
  ) {}

  /** Public notice-board search — only ever returns status = 'active' rooms. */
  async findAll(filters: RoomFiltersDto) {
    const {
      search, roomType, province, city, maxRentCents, minRentCents,
      billsIncluded, couplesAllowed, dssAccepted, guarantorAccepted, petsAllowed, availableNow,
      listerType, housemateProfile, householdSchedule, householdCleanliness, householdSocial,
      sortBy = 'newest', page = 1, limit = 12,
    } = filters;

    /**
     * The household filters — Phase 6.
     *
     * One nested `property` clause rather than four, because four separate
     * `property: { … }` keys in the same object literal would silently keep only
     * the last one. Prisma would not complain and the board would quietly ignore
     * three of the four filters a person had set.
     *
     * ⚠️ Any of these excludes every listing with no Property and every listing
     * whose household is `unstated` — which is most of them today. That is
     * inherent (an unstated household can neither match nor be ruled out), but
     * it means these controls can take the board from two hundred rooms to five
     * while looking like an ordinary narrowing, so the UI says so next to them.
     */
    const household = {
      ...(housemateProfile && { housemateProfile }),
      ...(householdSchedule && { householdSchedule }),
      ...(householdCleanliness && { householdCleanliness }),
      ...(householdSocial && { householdSocial }),
    };

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
      ...(listerType && { listerType }),
      ...(Object.keys(household).length > 0 && { property: { is: household } }),
      // 'Available now' means within a fortnight, not strictly today. Someone
      // searching on the 25th counts a room free on the 1st as immediate, and
      // a same-day filter would return almost nothing on most days.
      ...(availableNow && {
        availableFrom: { lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
      }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { locationDisplay: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy: any[] = [
      // Reduced visibility for an account with an unresolved post-tenancy
      // report against it (TenancyFlagsService). Ordering, not filtering: a
      // flag is an untested allegation until an admin reads it, so the rooms
      // stay on the board, stay applicable for, and stay findable by a direct
      // link — they simply stop being the first thing a tenant sees. A
      // dismissed flag decrements the count and the ranking returns on the
      // next query.
      //
      // Ahead of isFeatured on purpose: a boost is bought, and letting money
      // buy back the top spot while a deposit complaint is open is exactly
      // the trade this platform should not make.
      { landlord: { openFlagCount: 'asc' } },
      { isFeatured: 'desc' },
      ...(sortBy === 'price_asc' ? [{ rentCents: 'asc' }] : []),
      ...(sortBy === 'price_desc' ? [{ rentCents: 'desc' }] : []),
      ...(sortBy === 'newest' || sortBy === 'featured' ? [{ publishedAt: 'desc' }] : []),
    ];

    const skip = (page - 1) * limit;
    const [data, total, verifiedLandlords] = await Promise.all([
      this.prisma.room.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        // The room card shows the landlord's name, avatar and rating, so the
        // relation is loaded here rather than fetched per card by the client.
        ...PUBLIC_LANDLORD,
      }),
      this.prisma.room.count({ where }),
      /**
       * Landlords who have actually passed an identity check AND have a room
       * matching this search. Counted here, on the server, for two reasons.
       *
       * The hero stat said "verified landlords" and was computed in the browser
       * as `new Set(loadedRooms.map(r => r.landlordId)).size` — distinct
       * landlords among the rooms on screen. That was wrong twice over: it
       * never looked at whether anyone was verified, so an unverified landlord
       * counted as verified; and it counted only the CURRENT PAGE, so the
       * number of "verified landlords" grew as a visitor scrolled. A trust
       * figure that is both false and unstable is worse than no figure.
       *
       * `distinct` on landlordId rather than a groupBy: the question is how
       * many people, not how many rooms.
       */
      this.prisma.room
        .findMany({
          where: { ...where, landlord: { landlordProfile: { idVerified: true } } },
          select: { landlordId: true },
          distinct: ['landlordId'],
        })
        .then((rows) => rows.length),
    ]);

    return { data, total, page, limit, hasMore: skip + data.length < total, verifiedLandlords };
  }

  /**
   * @param viewerId  when the viewer is the owner, the view is not counted —
   *                  a landlord checking their own listing should not inflate
   *                  the number they use to judge how it is performing.
   */
  async findOne(id: string, viewerId?: string) {
    // With the landlord, same fields as the list. Without it, the detail page
    // could not show whether the person letting the room had been verified —
    // the one place a tenant decides whether to trust a stranger with their
    // deposit — and the aggregateRating in that page's JSON-LD was silently
    // dropped on every room, because the data it reads was never sent.
    const room = await this.prisma.room.findUnique({ where: { id }, ...PUBLIC_ROOM_DETAIL });
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

  async create(dto: CreateRoomDto, lister: { id: string; role: UserRole }) {
    // Billing paused — no per-landlord room-count limit while on the
    // temporary unlimited free tier. See file header comment.
    const { household, listerType, ...room } = dto;

    /**
     * A tenant account can only ever hold a sublet listing — Phase 6, Option A.
     *
     * Overridden rather than refused. A client that omits the field, or sends
     * the default, is not attacking anything and should not get an error about
     * a concept it never mentioned; and the one thing that must not happen is a
     * tenant account holding a listing that presents as an owner's. An owner
     * listing can only come from an account whose role says owner.
     *
     * ADMIN is left as whatever was asked for: an admin creating a listing is
     * doing it on somebody's behalf in a support capacity, and silently
     * relabelling it would hide what they did.
     */
    const resolvedListerType =
      lister.role === 'TENANT' ? 'sublessor' : (listerType ?? 'owner_landlord');

    const propertyId = await this.householdProperty(lister.id, resolvedListerType, {
      locationDisplay: room.locationDisplay,
      city: room.city,
      province: room.province,
    }, household);

    return this.prisma.room.create({
      data: {
        ...room,
        listerType: resolvedListerType,
        ...(propertyId ? { propertyId } : {}),
        title: sanitizeText(room.title),
        description: room.description ? sanitizeText(room.description) : room.description,
        availableFrom: new Date(room.availableFrom),
        landlordId: lister.id,
        status: 'draft',
      },
    });
  }

  /**
   * The Property that holds this listing's household facts — Phase 6.
   *
   * Household facts live on Property, not Room, and that decision predates this
   * phase: four rooms at one address share one kitchen, one set of rules and one
   * group of housemates, and held per room a lister types them four times and
   * the copies drift in front of tenants deciding where to live.
   *
   * A sub-lessor, though, has no yard screen and must not be made to create one
   * before they can list a room. So the Property is created for them, from the
   * listing, and they never see the word.
   *
   * ⚠️ Rooms are grouped by `locationDisplay`, which is a HEURISTIC and not an
   * identity. Two rooms a sub-lessor describes as "Observatory, Cape Town" are
   * assumed to be the same house; if they are not, the household facts of the
   * second overwrite the first. That is the right trade for the common case —
   * one person subletting rooms in the one place they live — and it is written
   * down here rather than left to be discovered. If sub-lessors with two houses
   * turn out to be common, this wants a real address on Room, which is a
   * migration rather than a tweak.
   *
   * Returns null when there is nothing to store and no grouping to do, so an
   * owner-let listing with no household block behaves exactly as it did before.
   */
  private async householdProperty(
    listerId: string,
    listerType: 'owner_landlord' | 'sublessor',
    place: { locationDisplay: string; city: string; province: string },
    household?: CreateRoomDto['household'],
  ): Promise<string | null> {
    const hasHousehold = household && Object.values(household).some((v) => v !== undefined);
    if (!hasHousehold) return null;
    // An owner's listing can carry household facts too, but it is grouped by
    // the yard the landlord chose — never auto-grouped behind their back.
    if (listerType !== 'sublessor') return null;

    const name = place.locationDisplay.slice(0, 120);
    const existing = await this.prisma.property.findFirst({
      where: { landlordId: listerId, name },
      select: { id: true },
    });

    const data = {
      ...(household.housemateProfile ? { housemateProfile: household.housemateProfile } : {}),
      ...(household.householdSchedule ? { householdSchedule: household.householdSchedule } : {}),
      ...(household.householdCleanliness ? { householdCleanliness: household.householdCleanliness } : {}),
      ...(household.householdSocial ? { householdSocial: household.householdSocial } : {}),
      ...(household.currentHousemates !== undefined ? { currentHousemates: household.currentHousemates } : {}),
      ...(household.houseRules !== undefined
        ? { houseRules: household.houseRules ? sanitizeText(household.houseRules) : null }
        : {}),
    };

    if (existing) {
      await this.prisma.property.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    const created = await this.prisma.property.create({
      data: {
        landlordId: listerId,
        name,
        city: place.city,
        province: place.province,
        sharedAmenities: [],
        ...data,
      },
      select: { id: true },
    });
    return created.id;
  }

  async update(id: string, dto: UpdateRoomDto, landlordId: string) {
    const before = await this.assertOwner(id, landlordId);
    this.assertPhotoLimit(dto.imagePaths);

    /**
     * The household block and `listerType` are pulled out before the spread.
     *
     * `listerType` is not editable at all after creation: flipping an owner
     * listing to a sublet, or back, would change what every applicant who
     * already applied was told about who they are dealing with. Someone who
     * picked the wrong one creates the listing again — a draft costs nothing.
     */
    const { household, listerType: _ignored, ...roomDto } = dto;
    if (household) {
      await this.householdProperty(
        landlordId,
        before.listerType,
        {
          locationDisplay: roomDto.locationDisplay ?? before.locationDisplay,
          city: roomDto.city ?? before.city,
          province: roomDto.province ?? before.province,
        },
        household,
      );
    }

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
        ...roomDto,
        ...(roomDto.title && { title: sanitizeText(roomDto.title) }),
        ...(roomDto.description && { description: sanitizeText(roomDto.description) }),
        ...(roomDto.availableFrom && { availableFrom: new Date(roomDto.availableFrom) }),
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
  /**
   * Permanently deletes a listing, row and all.
   *
   * Only when nothing depends on it. A room that has had applications carries
   * other people's records: their cover notes, the messages between them, and
   * the tenancy if it went that far. Deleting the room cascades all of that
   * away, and those are not the landlord's to erase — the privacy policy
   * commits to keeping applications for two years after outcome, and a tenant
   * in a deposit dispute may need the history.
   *
   * So: no applications ever, hard delete. Otherwise soft delete, which takes
   * it off the board and tells the applicants, and keeps the record.
   */
  async hardDelete(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);

    const applicationCount = await this.prisma.application.count({ where: { roomId: id } });
    if (applicationCount > 0) {
      throw new BadRequestException(
        `This listing has had ${applicationCount} application${applicationCount === 1 ? '' : 's'}, ` +
        'so it cannot be deleted outright — those records belong to the tenants too. ' +
        'Removing it takes it off the board and tells anyone still waiting.',
      );
    }

    // Saved-room entries are ours to clear: they are just a bookmark.
    await this.prisma.savedRoom.deleteMany({ where: { roomId: id } });
    await this.prisma.room.delete({ where: { id } });

    this.logger.log(`Room ${id} permanently deleted by landlord ${landlordId}`);
    return { deleted: true, id, title: room.title };
  }

  async softDelete(id: string, landlordId: string) {
    const room = await this.assertOwner(id, landlordId);
    if (room.status === 'draft') {
      throw new BadRequestException('Use discard for drafts — they are removed outright');
    }

    const stillOpen = await this.prisma.application.findMany({
      where: { roomId: id, cycle: room.relistCount, archivedAt: null, status: { in: ['pending', 'viewed', 'shortlisted'] } },
      include: { tenant: { select: { id: true, email: true, fullName: true, phone: true, phoneVerified: true } } },
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
      // Through the router, so a tenant with no email still learns the room is
      // gone rather than waiting on a reply that will never come.
      this.notice
        .deliver(application.tenant, {
          kind: 'room_unavailable',
          title: `"${room.title}" is no longer available`,
          body: 'Your application for it has closed. There are other rooms nearby.',
          link: '/tenant/dashboard',
        }, (email) => this.notifications.sendRoomUnavailableEmail(email, {
          tenantName: application.tenant.fullName,
          roomTitle: room.title,
        }))
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
      include: { tenant: { select: { id: true, email: true, fullName: true, phone: true, phoneVerified: true } } },
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
      // Through the router, so a tenant with no email still learns the room is
      // gone rather than waiting on a reply that will never come.
      this.notice
        .deliver(application.tenant, {
          kind: 'room_unavailable',
          title: `"${room.title}" is no longer available`,
          body: 'Your application for it has closed. There are other rooms nearby.',
          link: '/tenant/dashboard',
        }, (email) => this.notifications.sendRoomUnavailableEmail(email, {
          tenantName: application.tenant.fullName,
          roomTitle: room.title,
        }))
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
        include: { tenant: { select: { id: true, email: true, fullName: true, phone: true, phoneVerified: true } } },
      });
      if (open.length === 0) return;

      for (const application of open) {
        this.notice
          .deliver(application.tenant, {
            kind: 'rent_changed',
            title: `The rent on "${room.title}" changed while you were applying`,
            body: 'Open your application to see the new amount before you decide.',
            link: '/tenant/dashboard',
          }, (email) => this.notifications.sendRentChangedEmail(email, {
            tenantName: application.tenant.fullName,
            roomTitle: room.title,
            roomId,
            oldRentCents,
            newRentCents,
          }))
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
        include: { tenant: { select: { id: true, email: true, fullName: true, phone: true, phoneVerified: true } } },
      });
      if (saves.length === 0) return;

      await this.prisma.savedRoom.updateMany({
        where: { id: { in: saves.map((s) => s.id) } },
        data: { notifiedUnavailableAt: new Date() },
      });

      for (const save of saves) {
        this.notice
          .deliver(save.tenant, {
            kind: 'saved_room_gone',
            title: `A room you saved in ${room.locationDisplay} is gone`,
            body: room.title,
            link: '/tenant/saved',
          }, (email) => this.notifications.sendSavedRoomGoneEmail(email, {
            tenantName: save.tenant.fullName,
            roomTitle: room.title,
            locationDisplay: room.locationDisplay,
            reason,
          }))
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
