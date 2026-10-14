import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NoticeRouter } from '../notifications/notice-router.service';
import type { ViewingOutcome } from '@prisma/client';

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
    /**
     * ⚠️ Only a viewing that has NOT happened yet blocks a new one.
     *
     * The guard is about two times to turn up at. A viewing whose agreed time
     * has passed gives nobody anywhere to be, so it is not an arrangement any
     * more — and the elapsed-viewing notice offers "offer another time" as its
     * way out, which this clause is what makes work. The question of what
     * became of the old one stays open and stays asked until somebody answers
     * it; a new invitation does not answer it.
     */
    const open = await this.prisma.roomViewing.findFirst({
      where: {
        applicationId,
        status: { in: ['proposed', 'accepted'] },
        startsAt: { gte: new Date() },
      },
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

  /**
   * What happened about a viewing whose agreed time has passed — Phase 8n.
   *
   * ── Why this exists
   *
   * A viewing was proposed, accepted, and then the day came and went. Until
   * now the row simply stayed `accepted` for ever: the tenant dashboard kept
   * saying "They are coming" about a Saturday three weeks ago, and neither
   * side was ever asked what had become of it. The most common real answers
   * are not "it happened" and "it did not" — they are "we met at a different
   * time we agreed between ourselves" and "I took another room", and a system
   * that cannot record those learns nothing and keeps asking.
   *
   * ── Who may record one
   *
   * Either side. They see different halves of the same event, and which of
   * them spoke is kept: "they did not come" from a landlord and "I could not
   * go" from a tenant are the same outcome told from two sides.
   *
   * ── What recording one does
   *
   * ⚠️ `fell_through_other_room` and `fell_through_other_tenant` CLOSE the
   * application, because the person deciding has said the letting is over for
   * this pair. The other three leave it exactly where it was.
   *
   * ⚠️ `fell_through_other_tenant` DOES NOT ACCEPT ANYBODY. The landlord has
   * decided somewhere else; this records who did not get the room and never
   * who did. Accepting is its own deliberate action with its own thirty-minute
   * undo, and inferring it from a dropdown would bypass that for a decision
   * about where a person lives. The reply points at the two honest next steps
   * instead — accept the person they chose, or pause the listing.
   */
  async recordOutcome(
    viewingId: string,
    userId: string,
    input: { outcome: ViewingOutcome; note?: string },
  ) {
    const viewing = await this.prisma.roomViewing.findUnique({
      where: { id: viewingId },
      select: {
        id: true, status: true, startsAt: true, meetingPlace: true,
        applicationId: true, outcome: true,
      },
    });
    if (!viewing) throw new NotFoundException('No such viewing');

    const application = await this.loadApplication(viewing.applicationId);
    const isLandlord = application.room.landlordId === userId;
    const isTenant = application.tenantId === userId;
    if (!isLandlord && !isTenant) {
      throw new ForbiddenException('That viewing is not yours.');
    }

    // ⚠️ Only a viewing that was actually ON can have an outcome. A cancelled
    // or declined one already says what happened, and a proposed one the
    // tenant never answered is not a missed appointment — nobody agreed to it.
    if (viewing.status !== 'accepted') {
      throw new BadRequestException(
        'Only a viewing both of you agreed to can have an outcome recorded.',
      );
    }
    if (viewing.startsAt > new Date()) {
      throw new BadRequestException(
        'That viewing has not happened yet. You can call it off if it is not going ahead.',
      );
    }
    if (viewing.outcome) {
      throw new BadRequestException('Somebody has already said what happened.');
    }

    const closes =
      input.outcome === 'fell_through_other_room' ||
      input.outcome === 'fell_through_other_tenant';

    const [updated] = await this.prisma.$transaction([
      this.prisma.roomViewing.update({
        where: { id: viewingId },
        data: {
          outcome: input.outcome,
          outcomeNote: input.note?.trim() || null,
          outcomeAt: new Date(),
          outcomeById: userId,
        },
      }),
      // Closing the application is the whole difference between the two
      // groups. `withdrawn` when the tenant walked, `rejected` when the
      // landlord did: the existing vocabulary already distinguishes who ended
      // it, and a third status meaning "ended at a viewing" would be a fourth
      // name for a thing two names already cover.
      ...(closes
        ? [this.prisma.application.update({
            where: { id: viewing.applicationId },
            data: {
              status: input.outcome === 'fell_through_other_room' ? 'withdrawn' : 'rejected',
              decidedAt: new Date(),
            },
          })]
        : []),
    ]);

    /** Whoever did NOT record it is the one who needs telling. */
    const tell = isLandlord ? application.tenant : application.room.landlord;
    const when = this.describe(viewing.startsAt);
    const said: Record<ViewingOutcome, string> = {
      happened: `The viewing on ${when} is marked as having happened.`,
      rearranged_privately: `They have recorded that you met at a different time, not the one on ${when}.`,
      no_answer: `The viewing on ${when} did not happen. The application is still open.`,
      fell_through_other_room: 'The applicant has taken a different room, so this application is closed.',
      fell_through_other_tenant: 'The room has gone to somebody else, so this application is closed.',
    };
    await this.notices.deliver(tell, {
      kind: 'viewing_outcome',
      title: `About the viewing for ${application.room.title}`,
      body: said[input.outcome] + (input.note?.trim() ? ` They said: "${input.note.trim()}"` : ''),
      link: isLandlord ? '/tenant/dashboard' : `/landlord/rooms/${application.room.id}/applicants`,
    });

    return {
      ...updated,
      applicationClosed: closes,
      // ⚠️ Said in the payload, not only on screen, so an integration reading
      // this API is told the same thing a person is: nobody was accepted here.
      nextStep:
        input.outcome === 'fell_through_other_tenant'
          ? 'Nobody has been accepted by recording this. Accept the person you chose, '
            + 'or pause the listing if the room is not available.'
          : null,
    };
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
   * Ones still to come, and — Phase 8n — ones whose agreed time has passed
   * with nobody having said what became of them. A list that kept last
   * month's declined invitations would bury the one on Saturday, so declined
   * and cancelled ones still never appear and an answered one drops out.
   *
   * ⚠️ The second clause is the whole reason the panel can show the notice at
   * all. Before it, `startsAt >= now` hid exactly the rows the notice is
   * about: the screen would have had a branch for a state the API could never
   * hand it — this codebase's own recurring defect, a check that cannot see
   * its subject.
   */
  async forTenant(tenantId: string) {
    const now = new Date();
    return this.prisma.roomViewing.findMany({
      where: {
        application: { tenantId },
        OR: [
          { status: { in: ['proposed', 'accepted'] }, startsAt: { gte: now } },
          { status: 'accepted', startsAt: { lt: now }, outcome: null },
        ],
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true, startsAt: true, meetingPlace: true, note: true, status: true,
        outcome: true,
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
