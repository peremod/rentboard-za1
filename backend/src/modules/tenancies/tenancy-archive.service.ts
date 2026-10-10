import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A finished letting, as a complete record — Phase F.
 *
 * ── Why this exists
 *
 * Everything in here was already in the database and none of it was on a
 * screen. `RentPeriod`, `Review`, `TenancyFlag` and `LeaseDocument` all key on
 * `tenancyId`, so three lettings for one tenant could never bleed into each
 * other — but the only places that read a tenancy were the tenant's rent
 * screen and the landlord's property screen, and both asked for live ones.
 *
 * So `legal/paia.ts` told the public this platform holds "tenancy history and
 * rent records" and there was no way for either party to see any of it. Phases
 * D and E fixed the two live screens; this is the record itself.
 *
 * ── Why /account and not /tenant or /landlord
 *
 * The same reason `/account/messages` lives there: a person can be the
 * landlord of one room and the tenant of another, and their history is ONE
 * list. A sub-lessor is both by definition (Phase 6), so in this market that
 * is not a corner case.
 *
 * ── What it is not
 *
 * Not a resurrection. There is no "message your old landlord", no relist
 * shortcut, no rent toggle. Both parties were there, so both may read; neither
 * may now change what happened.
 *
 * The one exception is deliberate and lives elsewhere: `RentService.dispute`
 * still accepts an answer on a finished letting, because the final month is
 * the mark that matters most and it is entered after the tenant has gone.
 * "Read-only" is the wrong word for this screen — "bounded" is the right one.
 */
@Injectable()
export class TenancyArchiveService {
  constructor(private prisma: PrismaService) {}

  /**
   * Finished lettings this person was in, either side, newest first.
   *
   * `ended` AND `cancelled`. A letting that fell through is part of what
   * happened and explains a gap in somebody's history, so it is here and
   * labelled rather than hidden — but it carries no rent and no reviews, which
   * is why the row says which it is.
   */
  async list(userId: string) {
    const rows = await this.prisma.tenancy.findMany({
      where: {
        status: { in: ['ended', 'cancelled'] },
        OR: [{ landlordId: userId }, { tenantId: userId }],
      },
      orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, status: true, startDate: true, endDate: true,
        rentCents: true, archivedAt: true, reviewsCloseAt: true,
        landlordId: true, tenantId: true,
        room: { select: { id: true, title: true, locationDisplay: true } },
        landlord: { select: { id: true, fullName: true } },
        tenant: { select: { id: true, fullName: true } },
        // Counted rather than loaded. A list of twenty lettings should not
        // fetch twenty rent ledgers to render twenty rows.
        _count: { select: { rentPeriods: true, documents: true } },
      },
    });

    return rows.map((t) => ({
      id: t.id,
      status: t.status,
      startDate: t.startDate,
      endDate: t.endDate,
      rentCents: t.rentCents,
      archivedAt: t.archivedAt,
      /** Which side this person was, so the row can name the other one. */
      role: t.landlordId === userId ? ('landlord' as const) : ('tenant' as const),
      otherParty: t.landlordId === userId ? t.tenant : t.landlord,
      room: t.room,
      monthsRecorded: t._count.rentPeriods,
      documentCount: t._count.documents,
      /** The one time-limited thing about a finished letting. */
      reviewsOpen: !!t.reviewsCloseAt && t.reviewsCloseAt.getTime() > Date.now(),
    }));
  }

  /**
   * One letting, assembled.
   *
   * ⚠️ The permission rules here are not uniform and must not be made uniform.
   * Each one exists for a reason recorded beside it, and flattening them into
   * "both parties were there, so show everything" is how this screen would
   * become the product's largest POPIA and defamation exposure in one step.
   */
  async record(tenancyId: string, userId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: {
        id: true, status: true, startDate: true, endDate: true, rentCents: true,
        archivedAt: true, reviewsCloseAt: true, endReason: true, endedById: true,
        leaseEndDate: true, noticePeriodDays: true, noticeGivenAt: true,
        noticeGivenById: true, createdAt: true,
        landlordId: true, tenantId: true, applicationId: true,
        room: { select: { id: true, title: true, locationDisplay: true, propertyId: true } },
        landlord: { select: { id: true, fullName: true } },
        tenant: { select: { id: true, fullName: true } },
      },
    });
    if (!tenancy) throw new NotFoundException('No such letting');
    if (tenancy.landlordId !== userId && tenancy.tenantId !== userId) {
      throw new ForbiddenException('You were not part of that letting');
    }

    const isLandlord = tenancy.landlordId === userId;

    const [periods, reviews, flags, documents, application, viewings, reports] =
      await Promise.all([
        /**
         * The whole ledger, oldest first. Chronological because this is a
         * record being read rather than a queue being worked: a person
         * checking what they paid reads down the months in order.
         */
        this.prisma.rentPeriod.findMany({
          where: { tenancyId },
          orderBy: { periodStart: 'asc' },
          select: {
            id: true, periodStart: true, status: true, amountCents: true,
            markedAt: true, tenantDisputedAt: true, tenantNote: true,
          },
        }),

        /**
         * PUBLISHED and not hidden, only.
         *
         * ⚠️ `publishedAt: { not: null }` is the double-blind rule, and this
         * screen is exactly where it would be broken by accident. A review is
         * withheld until both sides have written one or the window closes —
         * if the archive showed an unpublished one, either party could read
         * the other's before writing their own, which turns a rating into a
         * negotiation. `isHidden` is the moderation flag; a review an admin
         * has taken down must not come back through a different screen.
         *
         * Both parties may read what IS published. Every review on a tenancy
         * has one of them as author and the other as subject, and a `tenant`
         * review — which is deliberately not public — is here only ever shown
         * to the landlord who wrote it or the tenant it is about.
         */
        this.prisma.review.findMany({
          where: { tenancyId, publishedAt: { not: null }, isHidden: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, type: true, rating: true, comment: true,
            publishedAt: true, response: true, respondedAt: true,
            authorId: true, subjectId: true,
            author: { select: { id: true, fullName: true } },
          },
        }),

        /**
         * ⚠️ ONLY the ones this person raised.
         *
         * This is the strictest rule on the screen and it is not negotiable.
         * `TenancyFlag` is a private report to the platform that somebody
         * behaved badly, and the schema records why it is never shown to its
         * subject before an admin has looked at it: "publishing 'this landlord
         * withheld my deposit' against a named individual, unreviewed, is this
         * platform's largest defamation exposure in South Africa."
         *
         * `TenancyFlagsService.listMine` already filters on `raisedById` for
         * the same reason, and this matches it rather than inventing a looser
         * rule for a screen where both parties happen to be authorised.
         */
        this.prisma.tenancyFlag.findMany({
          where: { tenancyId, raisedById: userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, reason: true, detail: true, status: true,
            reviewNote: true, reviewedAt: true, createdAt: true,
          },
        }),

        /**
         * The paperwork. `path` is never returned — it is an ImageKit file
         * path and the only way to read one is a signed URL from
         * `LeaseDocumentsService.openUrlFor`, which re-checks the party. The
         * same shape its own `list()` returns, including `mine`, so the screen
         * does not compare ids itself and get it wrong.
         */
        this.prisma.leaseDocument.findMany({
          where: { tenancyId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, kind: true, label: true, sizeBytes: true,
            contentType: true, uploadedById: true, createdAt: true,
          },
        }),

        /** How it began. One application per tenancy, by construction. */
        this.prisma.application.findUnique({
          where: { id: tenancy.applicationId },
          select: {
            id: true, status: true, createdAt: true, viewedAt: true,
            decidedAt: true, coverNote: true,
          },
        }),

        this.prisma.roomViewing.findMany({
          where: { applicationId: tenancy.applicationId },
          orderBy: { startsAt: 'asc' },
          select: {
            id: true, startsAt: true, status: true, meetingPlace: true,
            respondedAt: true, cancelledAt: true,
          },
        }),

        /**
         * Problems reported about this letting — possible only since Phase B
         * gave `Report` a `tenancyId`.
         *
         * ⚠️ Only the ones this person filed, for the same reason as the flags
         * above: a report is an unreviewed accusation, and `ReportsService`
         * already refuses to attach one to a letting the filer was not in.
         * The admin resolution is included because the person who reported it
         * is owed the outcome.
         *
         * Historical reports carry no `tenancyId` and never will — inferring
         * one from a room and a date would manufacture facts about a
         * complaint. The screen says so rather than implying the list is
         * complete.
         */
        this.prisma.report.findMany({
          where: { tenancyId, reporterId: userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, reason: true, details: true, status: true,
            resolutionNote: true, reviewedAt: true, createdAt: true,
          },
        }),
      ]);

    return {
      tenancy: {
        ...tenancy,
        role: isLandlord ? ('landlord' as const) : ('tenant' as const),
        otherParty: isLandlord ? tenancy.tenant : tenancy.landlord,
        /** Who ended it, in the reader's terms rather than as an id. */
        endedBy: tenancy.endedById
          ? tenancy.endedById === userId
            ? ('you' as const)
            : ('them' as const)
          : null,
        noticeGivenBy: tenancy.noticeGivenAt
          ? tenancy.noticeGivenById === userId
            ? ('you' as const)
            : ('them' as const)
          : null,
        reviewsOpen:
          !!tenancy.reviewsCloseAt && tenancy.reviewsCloseAt.getTime() > Date.now(),
      },
      rent: {
        periods,
        /** Summed here so the screen cannot disagree with itself about it. */
        monthsRecorded: periods.length,
        monthsPaid: periods.filter((p) => p.status === 'paid').length,
        monthsUnpaid: periods.filter((p) => p.status === 'unpaid').length,
        monthsDisputed: periods.filter((p) => p.tenantDisputedAt).length,
      },
      reviews,
      flags,
      documents: documents.map((d) => ({ ...d, mine: d.uploadedById === userId })),
      application,
      viewings,
      reports,
      /**
       * ⚠️ What this record does NOT contain, stated in the payload rather
       * than left for a reader to assume.
       *
       * `LandlordNote` is keyed on the TENANT and is visible to its author
       * alone — "the moment a note could be read by anyone but its author it
       * stops being a memory aid and becomes an unregulated reference that
       * follows a person around". It is not in this response for either party,
       * including the landlord who wrote it: this is a shared screen, and a
       * private note has no business being assembled into one.
       *
       * The message thread is not here either. It lives at
       * `/account/messages`, keyed on the application, and duplicating it into
       * a second screen would mean two places to get read-state wrong.
       */
      excluded: {
        landlordNotes: 'Private to whoever wrote them, and never part of a shared record.',
        messages: 'The conversation is at /account/messages, where it has always been.',
      },
    };
  }
}
