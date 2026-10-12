import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NoticeRouter } from '../notifications/notice-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenanciesService } from '../tenancies/tenancies.service';
import { ReferralsService } from '../referrals/referrals.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApplicantInboxDto } from './dto/inbox.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/**
 * Applications — create (0.5.0) + the full status lifecycle (this pass).
 * Every transition below fires the matching NotificationsService template
 * that was built (but unused) in pass 0.5.0 — see that pass's README note.
 */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private whatsapp: WhatsappService,
    private config: ConfigService,
    private tenancies: TenanciesService,
    private referrals: ReferralsService,
    private notice: NoticeRouter,
  ) {}

  async create(dto: CreateApplicationDto, tenantId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      include: { landlord: { include: { landlordProfile: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'active') {
      // A specific reason beats a generic refusal — a tenant who sees
      // "reserved" knows to check back, one who sees "let" knows not to.
      const reason: Record<string, string> = {
        reserved: 'This room is reserved for another tenant while they finalise. It may become available again.',
        paused: 'The landlord has paused this listing. It may reopen shortly.',
        let: 'This room has been let.',
        deleted: 'This listing has been removed.',
        draft: 'This listing is not published yet.',
      };
      throw new BadRequestException(reason[room.status] ?? 'This room is no longer accepting applications');
    }
    if (room.landlordId === tenantId) throw new ForbiddenException('You cannot apply to your own listing');

    // Applications are scoped to the room's current letting cycle, so a tenant
    // who applied before a relist may apply again to the new cycle.
    const existing = await this.prisma.application.findUnique({
      where: {
        roomId_tenantId_cycle: { roomId: dto.roomId, tenantId, cycle: room.relistCount },
      },
    });
    if (existing) {
      // Withdrawing is meant to be reversible while the room is still
      // available. The unique constraint is per cycle, so a withdrawn
      // application occupies the slot and blocked re-applying entirely —
      // the tenant was told 'you have already applied' for one they had
      // deliberately taken back.
      if (existing.status === 'withdrawn') {
        const reopened = await this.prisma.application.update({
          where: { id: existing.id },
          data: {
            status: 'pending',
            decidedAt: null,
            coverNote: dto.coverNote ? sanitizeText(dto.coverNote) : existing.coverNote,
            // Reset the clock: the landlord is being asked to look again.
            createdAt: new Date(),
            viewedAt: null,
          },
        });

        await this.prisma.room
          .update({ where: { id: dto.roomId }, data: { applicationCount: { increment: 1 } } })
          .catch(() => {});

        this.logger.log(`Withdrawn application ${existing.id} reopened by tenant ${tenantId}`);
        return reopened;
      }

      throw new ConflictException('You have already applied for this room');
    }

    const [application, tenant] = await Promise.all([
      this.prisma.application.create({
        data: {
          roomId: dto.roomId,
          tenantId,
          cycle: room.relistCount,
          coverNote: dto.coverNote ? sanitizeText(dto.coverNote) : dto.coverNote,
        },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: tenantId } }),
    ]);

    await this.prisma.room.update({ where: { id: room.id }, data: { applicationCount: { increment: 1 } } });

    // Through the router: a landlord with no email address must not silently
    // miss an application, which is the single worst consequence of making email
    // optional. When there IS an address the email path runs unchanged.
    await this.notice.deliver(room.landlord, {
      kind: 'new_application',
      title: `${tenant.fullName} applied for "${room.title}"`,
      body: 'Open the app to read their note and respond.',
      link: `/landlord/rooms/${room.id}/applicants`,
    }, (email) => this.notifications.sendNewApplicationEmail(email, {
      landlordName: room.landlord.fullName,
      tenantName: tenant.fullName,
      roomTitle: room.title,
      applicationId: application.id,
    }));
    if (room.landlord.landlordProfile) {
      await this.whatsapp.notifyLandlord(
        room.landlord.landlordProfile.id,
        `📬 New Mastande application: ${tenant.fullName} applied for "${room.title}". Reply on the app to respond.`,
      );
    }

        // Applying is what makes a referred tenant real.
    this.referrals.qualify(tenantId, 'applied').catch(() => {});

    return application;
  }

  /**
   * Why an application closed, in the tenant's terms.
   *
   * Previously this said "the landlord relisted this room" for every closure,
   * including the common case where the room was simply let to someone else.
   * Being told the wrong reason is worse than being told none: a tenant who
   * lost out to another applicant reads "relisted" as the landlord messing
   * them about.
   */
  private closureReason(a: { status: string; cycle: number; archivedAt: Date | null; room?: { status: string; relistCount: number } | null }): string | null {
    if (!a.archivedAt) return null;

    const room = a.room;

    if (a.status === 'accepted') {
      /**
       * ⚠️ This used to read "This tenancy ended and the room has been
       * relisted." It described a transition the system does not perform.
       *
       * `archivedAt` is set by a RELIST, and nothing else sets it — ending a
       * tenancy does not relist the room (that is the landlord's decision, and
       * `TenanciesService.end` prompts them rather than doing it). So this
       * branch is only ever reached when the landlord has relisted a room they
       * had let to this person, which may be after a tenancy ended, after one
       * that fell through, or after a letting that was never recorded at all.
       * The old sentence asserted the first of those three as fact.
       *
       * What is actually true in every case: they had the room, and it is open
       * to applications again.
       */
      return 'You had this room, and the landlord has since put it back on the board.';
    }
    if (room?.status === 'deleted') {
      return 'The landlord removed this listing.';
    }
    // Let while this application was open — the usual case, and the one that
    // was being mislabelled.
    if (room?.status === 'let' && room.relistCount === a.cycle) {
      return 'This room was let to another applicant.';
    }
    if (room && room.relistCount > a.cycle) {
      return 'The landlord relisted this room, so this application was closed. You can apply again.';
    }
    return 'This application was closed because the room is no longer available.';
  }

  /**
   * Returns active applications first, then closed ones. `isArchived` tells the
   * tenant an application ended because the room was relisted or let to someone
   * else, rather than leaving a stale 'pending' or 'accepted' on screen.
   */
  async getMyApplications(tenantId: string) {
    const applications = await this.prisma.application.findMany({
      where: { tenantId },
      include: {
        room: true,
        // ⚠️ The letting, so the dashboard can stop lying about the status.
        //
        // An Application stays `accepted` forever; the move-in is a Tenancy.
        // Without this the tenant's dashboard filed a room they had already
        // moved into under "Your applications — Live, you're waiting on the
        // landlord", which is three wrong statements in one line. Reported in
        // those words.
        //
        // Two fields, deliberately. The rent figure, the notice dates and the
        // lease terms all live on Tenancy too and none of them belongs in a
        // list of applications; the rent screen is where a tenancy is read.
        tenancy: { select: { status: true, startDate: true } },
      },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
    });

    return applications.map((a) => ({
      ...a,
      isArchived: a.archivedAt !== null,
      // Only meaningful when archived; drives the label on the tenant card.
      archivedReason: this.closureReason(a),
    }));
  }

  /** Landlord's applicant list for one of their own rooms. */
  /**
   * Current-cycle applicants only. Applications from before a relist are
   * archived, not deleted, so they never resurface as new applicants.
   */
  async getRoomApplications(roomId: string, landlordId: string) {
    const room = await this.assertRoomOwner(roomId, landlordId);
    return this.prisma.application.findMany({
      where: { roomId, cycle: room.relistCount, archivedAt: null },
      include: {
        tenant: {
          select: {
            id: true, fullName: true, email: true, avatarPath: true, isVerified: true,
            // Whether this applicant holds a Renter's Passport — the flag only,
            // so the card can show the badge. What the badge rests on is
            // fetched separately, per applicant, when the landlord opens one:
            // pulling every applicant's checks here would mean requesting
            // personal information about people whose applications may never
            // be opened.
            tenantProfile: { select: { hasPassport: true, passportExpiresAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every applicant across everything this lister lets — Phase 7c.
   *
   * ── Why this exists
   *
   * Applicants were reachable only at `rooms/:roomId/applicants`, so a landlord
   * with six rooms had six screens to check and no way to know which of them
   * was worth opening. The brief calls it out, and the yard screen's
   * "N waiting" badges were the only hint anybody had.
   *
   * ── What "unread" means, since the column it rests on was never written
   *
   * `Message.readAt` has existed since messaging shipped and nothing ever set
   * it — another column whose name promised something no code did. It is set
   * now, when the recipient opens the thread (MessagesService.getThread), which
   * is what makes this orderable at all.
   *
   * So an application is unread when the landlord has never opened it
   * (`status: pending`) OR the applicant has sent something the landlord has
   * not read. That is the question a landlord is asking — "what is waiting on
   * me" — rather than a literal per-row boolean.
   *
   * ── Ordering, not filtering
   *
   * `sortBy: 'unread'` puts those first and keeps the rest below. A landlord
   * who has read everything must still see their applicants; a view that
   * emptied itself once they were up to date would read as "nobody applied".
   */
  async inbox(landlordId: string, filters: ApplicantInboxDto) {
    const { roomId, propertyId, status, sortBy = 'newest' } = filters;

    /**
     * Scoped by the lister in the WHERE, through the room — never by a guard
     * alone. `ListerGuard` admits any lister and `LandlordGuard` admits every
     * admin, so the only thing that keeps one landlord's applicants out of
     * another's inbox is this clause.
     */
    const applications = await this.prisma.application.findMany({
      where: {
        archivedAt: null,
        room: {
          landlordId,
          ...(roomId ? { id: roomId } : {}),
          ...(propertyId ? { propertyId } : {}),
        },
        ...(status ? { status } : {}),
      },
      include: {
        tenant: {
          select: {
            id: true, fullName: true, avatarPath: true,
            // The badge only. What it rests on is fetched per applicant when
            // the landlord opens one: requesting personal information about
            // people whose applications may never be opened is exactly what
            // POPIA minimality is about.
            tenantProfile: { select: { hasPassport: true } },
          },
        },
        room: {
          select: {
            id: true, title: true, status: true, rentCents: true, relistCount: true,
            property: { select: { id: true, name: true } },
          },
        },
        messages: {
          select: { id: true, senderId: true, readAt: true, createdAt: true, channel: true, body: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = applications
      // A relisted room's previous cycle is history, not an applicant. The
      // `archivedAt: null` above catches most of it; a room relisted inside the
      // same request window can still carry one, so the cycle is checked too.
      .filter((a) => a.cycle === a.room.relistCount)
      .map((a) => {
        const fromTenant = a.messages.filter((m) => m.senderId === a.tenantId);
        const unreadMessages = fromTenant.filter((m) => !m.readAt).length;
        const last = a.messages[0] ?? null;
        const { messages, ...rest } = a;
        return {
          ...rest,
          messageCount: messages.length,
          unreadMessages,
          /** Never opened, or they have said something since you last looked. */
          needsAttention: a.status === 'pending' || unreadMessages > 0,
          lastMessage: last
            ? {
                body: last.body.slice(0, 140),
                channel: last.channel,
                createdAt: last.createdAt,
                fromTenant: last.senderId === a.tenantId,
              }
            : null,
        };
      });

    if (sortBy === 'unread') {
      rows.sort((a, b) => {
        if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    }

    return {
      data: rows,
      total: rows.length,
      needsAttention: rows.filter((r) => r.needsAttention).length,
    };
  }

  /** Marks an application as viewed the first time a landlord opens it — idempotent, and emails the tenant only once. */
  async markViewed(applicationId: string, landlordId: string) {
    const application = await this.getOwnedApplication(applicationId, landlordId);
    if (application.status !== 'pending') return application;

    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: { status: 'viewed', viewedAt: new Date() },
    });

    const tenant = await this.prisma.user.findUniqueOrThrow({ where: { id: application.tenantId } });
    await this.notice.deliver(tenant, {
      kind: 'application_viewed',
      title: `${this.letterOf(application.room)} has seen your application for "${application.room.title}"`,
      link: '/tenant/dashboard',
    }, (email) => this.notifications.sendApplicationViewedEmail(email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      applicationId,
    }));
    return updated;
  }

  async shortlist(applicationId: string, landlordId: string) {
    const application = await this.getOwnedApplication(applicationId, landlordId);
    this.assertNotDecided(application);

    const updated = await this.prisma.application.update({ where: { id: applicationId }, data: { status: 'shortlisted' } });

    const tenant = await this.prisma.user.findUniqueOrThrow({ where: { id: application.tenantId } });
    await this.notice.deliver(tenant, {
      kind: 'shortlisted',
      title: `You have been shortlisted for "${application.room.title}"`,
      link: '/tenant/dashboard',
    }, (email) => this.notifications.sendShortlistedEmail(email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      applicationId,
    }));
    return updated;
  }

  /**
   * Accepting an application auto-rejects every other still-open applicant
   * for the same room, with a considerate note — matches the behaviour
   * shown in the Sprint3 reference (RentBoard-Sprint3-Code.html).
   */
  /**
   * Undo a shortlist. Returns the application to 'viewed', not 'pending' —
   * the landlord has read it, and pretending otherwise would restart the
   * response-time clock and mislead the tenant.
   */
  /**
   * Reverses an acceptance within a short window.
   *
   * Accepting is the most destructive action a landlord can take: it marks the
   * room let, auto-rejects everyone else, and emails all of them. A mis-click
   * or a tenant who pulls out an hour later was previously unrecoverable, and
   * the landlord's only option was to relist — which starts a new cycle and
   * loses every applicant permanently.
   *
   * The window matches undo-let at 30 minutes. Beyond that the rejected
   * applicants have had the email and may have taken other rooms, so silently
   * reinstating them would be worse than making the landlord relist.
   */
  async undoAccept(applicationId: string, landlordId: string) {
    const application = await this.getOwnedApplication(applicationId, landlordId);

    if (application.status !== 'accepted') {
      throw new BadRequestException('This application was not accepted');
    }

    const UNDO_WINDOW_MS = 30 * 60 * 1000;
    const decidedAt = application.decidedAt?.getTime() ?? 0;
    if (Date.now() - decidedAt > UNDO_WINDOW_MS) {
      throw new BadRequestException(
        'The 30-minute window to undo has passed. The other applicants have already been told. ' +
        'You can relist the room to start again.',
      );
    }

    // Only reinstate the ones this acceptance rejected — not applicants the
    // landlord had rejected deliberately beforehand.
    const collateral = await this.prisma.application.findMany({
      where: {
        roomId: application.roomId,
        cycle: application.cycle,
        id: { not: applicationId },
        status: 'rejected',
        rejectionReason: 'Another applicant was chosen for this room.',
        decidedAt: { gte: new Date(decidedAt - 60_000) },
      },
      select: { id: true },
    });

    await this.prisma.$transaction([
      this.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'shortlisted', decidedAt: null },
      }),
      this.prisma.application.updateMany({
        where: { id: { in: collateral.map((c) => c.id) } },
        // Back to shortlisted rather than pending: the landlord had read them,
        // and resetting that would restart the response-time clock.
        data: { status: 'shortlisted', decidedAt: null, rejectionReason: null },
      }),
      this.prisma.room.update({
        where: { id: application.roomId },
        data: { status: 'active', letAt: null },
      }),
    ]);

    this.logger.log(
      `Acceptance undone for ${applicationId}; ${collateral.length} rejection(s) reversed`,
    );

    return {
      undone: true,
      reinstated: collateral.length,
      message: collateral.length > 0
        ? `Acceptance undone. ${collateral.length} other applicant${collateral.length === 1 ? ' was' : 's were'} reinstated.`
        : 'Acceptance undone. The room is back on the board.',
    };
  }

  async unshortlist(applicationId: string, landlordId: string) {
    const application = await this.getOwnedApplication(applicationId, landlordId);
    if (application.status !== 'shortlisted') {
      throw new BadRequestException('This application is not shortlisted');
    }
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { status: 'viewed' },
    });
  }

  async accept(applicationId: string, landlordId: string) {
    const application = await this.getOwnedApplication(applicationId, landlordId);
    this.assertNotDecided(application);

    const [updated, tenant] = await Promise.all([
      this.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'accepted', decidedAt: new Date() },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: application.tenantId } }),
    ]);

    await this.prisma.room.update({ where: { id: application.roomId }, data: { status: 'let', letAt: new Date() } });

    await this.notice.deliver(tenant, {
      kind: 'accepted',
      title: `You got the room — "${application.room.title}"`,
      body: `${this.letterOf(application.room)} accepted your application. Open the app to arrange moving in.`,
      link: '/tenant/dashboard',
    }, (email) => this.notifications.sendAcceptedEmail(email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      rentCents: application.room.rentCents,
      city: application.room.city,
    }));

    await this.autoRejectOthers(application.roomId, applicationId, 'Another applicant was chosen for this room.');

    // Open a tenancy record. It stays 'pending' until someone confirms the
    // move-in actually happened — accepted lettings fall through often, and an
    // unconfirmed one must not generate review prompts or feed a rating.
    // Never allowed to fail the acceptance itself.
    this.tenancies.createFromApplication(applicationId).catch((err: unknown) =>
      this.logger.error(
        `Could not open a tenancy for application ${applicationId}`,
        err instanceof Error ? err.stack : String(err),
      ),
    );

    return updated;
  }

  async reject(applicationId: string, landlordId: string, dto: RejectApplicationDto) {
    const application = await this.getOwnedApplication(applicationId, landlordId);
    this.assertNotDecided(application);

    const [updated, tenant] = await Promise.all([
      this.prisma.application.update({
        where: { id: applicationId },
        data: {
          status: 'rejected',
          decidedAt: new Date(),
          // Persisted so undo-accept can tell a deliberate rejection from one
          // caused by accepting someone else.
          rejectionReason: dto.reason ? sanitizeText(dto.reason) : 'Rejected by the landlord.',
        },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: application.tenantId } }),
    ]);

    await this.notice.deliver(tenant, {
      kind: 'rejected',
      title: `"${application.room.title}" went to someone else`,
      body: dto.reason
        ? `${this.letterOf(application.room)} said: ${sanitizeText(dto.reason)}`
        : 'There are other rooms in the same area — have a look.',
      link: `/?province=${encodeURIComponent(application.room.province)}`,
    }, (email) => this.notifications.sendRejectionEmail(email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      reason: dto.reason ? sanitizeText(dto.reason) : dto.reason,
      searchUrl: `${this.config.get<string>('frontendUrl')}/?province=${encodeURIComponent(application.room.province)}`,
    }));
    return updated;
  }

  /**
   * Tenant withdraws their own application.
   *
   * Not a delete: the landlord may already have shortlisted this person and
   * needs to see why they disappeared, and the privacy policy commits to
   * retaining applications for 2 years after outcome.
   */
  async withdraw(applicationId: string, tenantId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { room: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.tenantId !== tenantId) {
      throw new ForbiddenException('You can only withdraw your own application');
    }
    if (application.status === 'withdrawn') {
      throw new BadRequestException('This application has already been withdrawn');
    }
    if (application.status === 'accepted') {
      throw new BadRequestException(
        'This application was accepted. Contact the landlord directly to let them know your plans have changed.',
      );
    }
    if (application.archivedAt) {
      throw new BadRequestException('This application is already closed');
    }

    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: { status: 'withdrawn', decidedAt: new Date() },
    });

    // Keep the room's counter honest — the landlord's list no longer shows this one.
    await this.prisma.room
      .update({ where: { id: application.roomId }, data: { applicationCount: { decrement: 1 } } })
      .catch(() => {});

    return updated;
  }

  private async autoRejectOthers(roomId: string, exceptApplicationId: string, reason: string) {
    const others = await this.prisma.application.findMany({
      where: { roomId, id: { not: exceptApplicationId }, status: { in: ['pending', 'viewed', 'shortlisted'] } },
      include: { tenant: true, room: true },
    });

    for (const other of others) {
      await this.prisma.application.update({
        where: { id: other.id },
        // The reason is the marker undo-accept matches on to reinstate exactly
        // these and no others.
        data: { status: 'rejected', decidedAt: new Date(), rejectionReason: reason },
      });
      await this.notice.deliver(other.tenant, {
        kind: 'rejected',
        title: `"${other.room.title}" went to someone else`,
        body: reason,
        link: `/?province=${encodeURIComponent(other.room.province)}`,
      }, (email) => this.notifications.sendRejectionEmail(email, {
        tenantName: other.tenant.fullName,
        roomTitle: other.room.title,
        reason,
        searchUrl: `${this.config.get<string>('frontendUrl')}/?province=${encodeURIComponent(other.room.province)}`,
      }));
    }
  }

  /**
   * What to call the person letting the room, to the applicant — Phase 6.
   *
   * "The landlord accepted your application" is false on a sublet listing, and
   * it is false in the way that matters: the whole point of marking sublets is
   * that an applicant knows they are dealing with a tenant, not an owner. A
   * notice that calls them the landlord undoes the disclaimer on the room page.
   *
   * Plain English rather than "the sub-lessor", which is a word almost nobody
   * uses about their own housing. The owner case is left exactly as it was.
   */
  private letterOf(room: { listerType: string }): string {
    return room.listerType === 'sublessor' ? 'The person letting the room' : 'The landlord';
  }

  private async getOwnedApplication(applicationId: string, landlordId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { room: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.room.landlordId !== landlordId) throw new ForbiddenException('You do not have permission to manage this application');
    return application;
  }

  private async assertRoomOwner(roomId: string, landlordId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.landlordId !== landlordId) throw new ForbiddenException('You do not have permission to view these applications');
    return room;
  }

  private assertNotDecided(application: { status: string }) {
    if (['accepted', 'rejected', 'withdrawn'].includes(application.status)) {
      throw new BadRequestException(`This application has already been ${application.status}`);
    }
  }
}
