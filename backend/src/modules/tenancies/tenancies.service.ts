import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NoticeRouter } from '../notifications/notice-router.service';

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

  constructor(
    private prisma: PrismaService,
    private notice: NoticeRouter,
  ) {}

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

    const cancelled = await this.prisma.tenancy.update({
      where: { id },
      data: {
        status: 'cancelled',
        endedById: userId,
        endReason: reason,
        endDate: new Date(),
        // ⚠️ Archived in the same update, unlike `end()`.
        //
        // A letting that fell through has no aftermath: no reviews open (and
        // `tenancy-lifecycle-drive` asserts `reviewsCloseAt` stays null), no
        // rent, nothing either party can still do about it. The nightly
        // archive pass waits for a review window to close, so a cancelled
        // tenancy would sit unarchived forever — a row that is finished but
        // never reads as finished.
        archivedAt: new Date(),
      },
    });

    /**
     * Put the room back on the board.
     *
     * ⚠️ Accepting an application sets the room to `let`. Nothing ever set it
     * back, so a letting that FELL THROUGH left the room `let` indefinitely:
     * off the public board (`rooms.service` filters `status: 'active'`), out of
     * the sitemap, and invisible to every tenant — for a room nobody ever
     * moved into. The landlord had to find "relist" themselves, with nothing
     * telling them to.
     *
     * Straight back to `active`, not a relist, and the difference matters.
     * `relist()` archives every open application and increments
     * `relistCount`; here there is nothing to archive — `autoRejectOthers`
     * rejected the other applicants when this one was accepted, and they stay
     * rejected, which is what actually happened. This is the shape of
     * `undoLet`: the room simply was not let.
     *
     * Only from `let`. A landlord who has already paused, removed or relisted
     * the room in the meantime has said something more recent than this.
     */
    await this.restoreRoomIfStillLet(tenancy.roomId, 'the letting fell through');

    return cancelled;
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

    // Never allowed to fail the ending. A tenancy ends because it ended; a
    // notification that cannot be delivered must not undo the record of it.
    await this.announceEnding(id, userId).catch((e: unknown) =>
      this.logger.error(`Could not announce the end of tenancy ${id}`, e instanceof Error ? e.stack : String(e)),
    );

    return updated;
  }

  /**
   * Tell both parties the letting is over, and the landlord that the room is
   * free.
   *
   * ── Why this exists
   *
   * Ending a tenancy wrote four columns on one row and told nobody. There are
   * 32 `Notice.kind` values in this codebase and, until this, not one for a
   * tenancy starting or ending — the single biggest event in the lifecycle
   * logged a line to the server console and produced nothing a person could
   * read. A tenant learned their review window had opened only by happening to
   * open the dashboard inside 30 days.
   *
   * ── Why no email
   *
   * `deliver` sends an email when it can and then returns WITHOUT writing a
   * notice row. Passing no email function therefore guarantees the in-app
   * notice exists for everybody, including the phone-only landlord for whom it
   * is the only channel there is. That is the right trade here, and it has a
   * cost worth naming rather than hiding: somebody who does not log in inside
   * 30 days misses the review window. See docs/OUTSTANDING.md §33.
   */
  private async announceEnding(tenancyId: string, endedById: string) {
    const t = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: {
        id: true, roomId: true, landlordId: true, tenantId: true, endDate: true,
        room: { select: { id: true, title: true, status: true, propertyId: true } },
        landlord: { select: { id: true, fullName: true, email: true, phone: true, phoneVerified: true } },
        tenant: { select: { id: true, fullName: true, email: true, phone: true, phoneVerified: true } },
      },
    });
    if (!t) return;

    const roomTitle = t.room?.title ?? 'the room';
    // Who did it, in the other person's terms. "You recorded this" and "your
    // landlord recorded this" are different things to read, and a notice that
    // tells somebody about their own action reads as a system that is not
    // paying attention.
    const byTenant = endedById === t.tenantId;

    await this.notice.deliver(t.tenant, {
      kind: 'tenancy_ended',
      title: `Your time at "${roomTitle}" is recorded as ended`,
      body:
        (byTenant
          ? 'You marked this as ended. '
          : `${t.landlord.fullName} marked this as ended. `) +
        `You have ${REVIEW_WINDOW_DAYS} days to review the room and the landlord. ` +
        'Neither review is shown until you have both written one, or the window closes. ' +
        'Your rent record for this room stays where it is.',
      link: '/tenant/dashboard',
    });

    await this.notice.deliver(t.landlord, {
      kind: 'tenancy_ended',
      title: `${t.tenant.fullName} has moved out of "${roomTitle}"`,
      body:
        (byTenant
          ? `${t.tenant.fullName} marked this as ended. `
          : 'You marked this as ended. ') +
        `You have ${REVIEW_WINDOW_DAYS} days to review them, and they have ${REVIEW_WINDOW_DAYS} days ` +
        'to review you and the room. Neither is shown until both are in, or the window closes.',
      link: '/landlord/dashboard',
    });

    /**
     * ⚠️ A PROMPT, not an automatic relist. This is a product decision.
     *
     * Relisting republishes the room with its old photos, its old price and
     * its old description on the day a tenant moves out — and `relist()`
     * archives every open application and increments `relistCount`, which is
     * destructive in a way the landlord has not asked for. Deciding to let a
     * room again, and at what rent, is theirs.
     *
     * But the room going quietly invisible is not an option either, which is
     * what happened: `let` with nothing to move it back, so it stayed off the
     * board and out of the sitemap for good. So: one notice, with the room's
     * own screen on the end of it.
     *
     * Only while the room is still `let`. A landlord who has already relisted,
     * paused or removed it has said something more recent.
     */
    if (t.room?.status === 'let') {
      await this.notice.deliver(t.landlord, {
        kind: 'room_needs_relisting',
        title: `"${roomTitle}" is empty — put it back on the board when you are ready`,
        body:
          'It is not listed at the moment, so nobody can find it or apply. Relisting takes one tap ' +
          'and you can change the rent and the available-from date on the way past. ' +
          'Nothing is published until you do.',
        link: t.room.propertyId
          ? `/landlord/properties/${t.room.propertyId}`
          : '/landlord/dashboard',
      });
    }
  }

  /**
   * Back to `active`, but only from `let`.
   *
   * Used where a letting ends before it began — see `cancel`. Deliberately not
   * `relist()`: that archives open applications and increments the cycle, and
   * there is nothing here to archive.
   *
   * The guard is the point. A landlord who has paused, removed or already
   * relisted the room has expressed something more recent than the stale
   * `let`, and overwriting it would be this method deciding it knows better.
   */
  private async restoreRoomIfStillLet(roomId: string, why: string) {
    const { count } = await this.prisma.room.updateMany({
      where: { id: roomId, status: 'let' },
      data: { status: 'active', letAt: null },
    });
    if (count) this.logger.log(`Room ${roomId} is back on the board — ${why}`);
    return count > 0;
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
