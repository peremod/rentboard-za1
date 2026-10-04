import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NoticeRouter } from '../notifications/notice-router.service';

/**
 * Inviting an applicant to come and see the room — Phase 7l.
 *
 * ── What did not exist before
 *
 * `ApplicationStatus` runs pending → viewed → shortlisted → accepted, and
 * `viewed` means the LANDLORD opened the application. Nothing recorded a room
 * viewing, so "I'll meet you Saturday at four" lived in the message thread and
 * nowhere else — no date either side could look up, and nothing the tenant
 * could answer.
 *
 * ── The address is the whole safety question
 *
 * The board shows a suburb, not a street. `Property.addressLine` exists and its
 * own form promises "Only you see this. It is never on a listing and never sent
 * to an applicant." So the meeting place is typed per viewing and NEVER read
 * from that column — see the migration for the full reasoning.
 *
 * Nothing here pre-fills, copies or suggests an address. If that ever changes,
 * the drive asserting it fails.
 */
@Injectable()
export class ViewingsService {
  private readonly log = new Logger(ViewingsService.name);

  constructor(
    private prisma: PrismaService,
    private notices: NoticeRouter,
  ) {}

  /** The application, with both parties and enough of the room to name it. */
  private async loadApplication(applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true, status: true, archivedAt: true, tenantId: true,
        tenant: { select: { id: true, email: true, phone: true, fullName: true } },
        room: {
          select: {
            id: true, title: true, landlordId: true,
            landlord: { select: { id: true, email: true, phone: true, fullName: true } },
          },
        },
      },
    });
    if (!application) throw new NotFoundException('No such application');
    return application;
  }

  /**
   * Invite this applicant to a viewing.
   *
   * ── Who, and when it is refused
   *
   * Only the room's landlord, and only on an application that is still live.
   * Inviting somebody you rejected, or whose application was archived when the
   * room was relisted, is a mistake rather than a feature — and it would hand a
   * residential address to somebody who has already been told no.
   */
  async invite(
    applicationId: string,
    landlordId: string,
    input: { startsAt: Date; meetingPlace: string; note?: string },
  ) {
    const application = await this.loadApplication(applicationId);

    if (application.room.landlordId !== landlordId) {
      throw new ForbiddenException('That is not your room.');
    }
    /**
     * ⚠️ A closed application cannot be invited.
     *
     * `withdrawn` means the tenant walked away, `rejected` means the landlord
     * said no, and `archivedAt` is set when the room is relisted or let to
     * somebody else. Sending any of them a time and an address is either a
     * mistake or something worse, and in all three cases the person is not
     * expecting to hear from us.
     */
    if (['rejected', 'withdrawn'].includes(application.status) || application.archivedAt) {
      throw new BadRequestException(
        'That application is closed. You can only invite somebody who is still applying.',
      );
    }

    const meetingPlace = input.meetingPlace?.trim();
    if (!meetingPlace || meetingPlace.length < 3) {
      throw new BadRequestException(
        'Say where to meet. An invitation with no place is one nobody can turn up to.',
      );
    }
    /**
     * ⚠️ In the future, and checked here rather than only in the DTO.
     *
     * An invitation to a time that has passed is not an invitation, and it is
     * the kind of thing a timezone mistake produces silently.
     */
    if (input.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Pick a time that has not already passed.');
    }

    /**
     * One live invitation per application at a time.
     *
     * Not a database constraint, because Prisma cannot express "unique where
     * status in (…)". Checked here and asserted by the drive: two open
     * invitations for the same person is two times to turn up at, and the
     * tenant has no way to tell which one is meant.
     */
    const open = await this.prisma.roomViewing.findFirst({
      where: { applicationId, status: { in: ['proposed', 'accepted'] } },
    });
    if (open) {
      throw new BadRequestException(
        'There is already a viewing arranged with this person. Cancel it before offering another time.',
      );
    }

    const viewing = await this.prisma.roomViewing.create({
      data: {
        applicationId,
        startsAt: input.startsAt,
        meetingPlace,
        note: input.note?.trim() || null,
      },
    });

    /**
     * ⚠️ The tenant has to actually be told, and the safety line goes with it.
     *
     * This product's own report reasons include `upfront_payment_demanded`, so
     * the risk of somebody being asked for money before they have seen a room
     * is known to the codebase. A viewing invitation is exactly when that
     * happens, so the warning travels with the invitation rather than living on
     * a legal page nobody opens.
     *
     * `NoticeRouter.deliver` never throws: a notification failing must not fail
     * the thing it was about.
     */
    const when = this.describe(input.startsAt);
    await this.notices.deliver(application.tenant, {
      kind: 'viewing_invited',
      title: `${application.room.landlord.fullName} has invited you to see ${application.room.title}`,
      body:
        `${when}, at ${meetingPlace}.`
        + (viewing.note ? ` ${viewing.note}` : '')
        + ' Say yes or no from your applications.'
        + ' Tell somebody where you are going, and never pay anything before you have seen the room.',
      link: '/tenant/dashboard',
    });

    this.log.log(`Viewing ${viewing.id} proposed on application ${applicationId}`);
    return viewing;
  }

  /**
   * The tenant answers.
   *
   * Only the tenant: a landlord accepting on somebody's behalf would turn a
   * proposal into an appointment the other person never agreed to.
   */
  async respond(
    viewingId: string,
    tenantId: string,
    answer: { accept: boolean; declineReason?: string },
  ) {
    const viewing = await this.prisma.roomViewing.findUnique({
      where: { id: viewingId },
      select: {
        id: true, status: true, startsAt: true, meetingPlace: true, applicationId: true,
      },
    });
    if (!viewing) throw new NotFoundException('No such viewing');

    const application = await this.loadApplication(viewing.applicationId);
    if (application.tenantId !== tenantId) {
      throw new ForbiddenException('That invitation is not yours.');
    }
    if (viewing.status !== 'proposed') {
      throw new BadRequestException(
        viewing.status === 'cancelled'
          ? 'That viewing was called off.'
          : 'You have already answered that invitation.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.roomViewing.update({
      where: { id: viewingId },
      data: {
        status: answer.accept ? 'accepted' : 'declined',
        respondedAt: now,
        declineReason: answer.accept ? null : (answer.declineReason?.trim() || null),
      },
    });

    /** The landlord needs the answer, or the arrangement is one-sided. */
    await this.notices.deliver(application.room.landlord, {
      kind: answer.accept ? 'viewing_accepted' : 'viewing_declined',
      title: answer.accept
        ? `${application.tenant.fullName} is coming to see ${application.room.title}`
        : `${application.tenant.fullName} cannot make the viewing`,
      body: answer.accept
        ? `${this.describe(viewing.startsAt)}, at ${viewing.meetingPlace}.`
        : `They were invited for ${this.describe(viewing.startsAt)}.`
          + (updated.declineReason ? ` They said: ${updated.declineReason}` : '')
          + ' You can offer another time.',
      link: `/landlord/rooms/${application.room.id}/applicants`,
    });

    return updated;
  }

  /**
   * Either side calls it off.
   *
   * Both can: a landlord whose geyser burst and a tenant who cannot get
   * transport are the same situation from opposite ends, and a product that
   * only lets one of them cancel makes the other simply not turn up.
   */
  async cancel(viewingId: string, userId: string) {
    const viewing = await this.prisma.roomViewing.findUnique({
      where: { id: viewingId },
      select: { id: true, status: true, startsAt: true, meetingPlace: true, applicationId: true },
    });
    if (!viewing) throw new NotFoundException('No such viewing');

    const application = await this.loadApplication(viewing.applicationId);
    const isLandlord = application.room.landlordId === userId;
    const isTenant = application.tenantId === userId;
    if (!isLandlord && !isTenant) {
      throw new ForbiddenException('That viewing is not yours.');
    }
    if (viewing.status === 'cancelled') {
      throw new BadRequestException('That viewing was already called off.');
    }
    if (viewing.status === 'declined') {
      throw new BadRequestException('That invitation was declined — there is nothing to call off.');
    }

    const now = new Date();
    const updated = await this.prisma.roomViewing.update({
      where: { id: viewingId },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        cancelledById: userId,
        /**
         * ⚠️ Cleared, because the CHECK constraint says a cancelled viewing
         * carries no answer — and because "they accepted" is no longer true of
         * a viewing that is not happening. The answer is not history worth
         * keeping at the cost of a row that contradicts itself.
         */
        respondedAt: null,
        declineReason: null,
      },
    });

    /** Whoever did NOT cancel is the one who needs telling. */
    const tell = isLandlord ? application.tenant : application.room.landlord;
    await this.notices.deliver(tell, {
      kind: 'viewing_cancelled',
      title: `The viewing for ${application.room.title} is off`,
      body: `It was set for ${this.describe(viewing.startsAt)}, at ${viewing.meetingPlace}.`
        + (isLandlord ? ' The landlord called it off.' : ' The applicant called it off.')
        + ' Nobody needs to go.',
      link: isLandlord ? '/tenant/dashboard' : `/landlord/rooms/${application.room.id}/applicants`,
    });

    return updated;
  }

  /** Viewings on one application, soonest first. Either party may read them. */
  async forApplication(applicationId: string, userId: string) {
    const application = await this.loadApplication(applicationId);
    if (application.room.landlordId !== userId && application.tenantId !== userId) {
      throw new ForbiddenException('That application is not yours.');
    }
    return this.prisma.roomViewing.findMany({
      where: { applicationId },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * What a tenant has been invited to, across every application.
   *
   * Only ones that have not happened yet and are still live: a list that kept
   * last month's declined invitations would bury the one on Saturday.
   */
  async forTenant(tenantId: string) {
    return this.prisma.roomViewing.findMany({
      where: {
        application: { tenantId },
        status: { in: ['proposed', 'accepted'] },
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true, startsAt: true, meetingPlace: true, note: true, status: true,
        application: {
          select: {
            id: true,
            room: { select: { id: true, title: true, locationDisplay: true } },
          },
        },
      },
    });
  }

  /**
   * "Saturday 11 Oct at 16:00", in South African time.
   *
   * ⚠️ Africa/Johannesburg explicitly, not the server's locale. The server runs
   * UTC and everybody reading this message is in SAST — a viewing described two
   * hours early is somebody standing at a gate alone.
   */
  private describe(at: Date): string {
    return at.toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      weekday: 'long', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
}
