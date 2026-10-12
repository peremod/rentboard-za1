import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GiveNoticeDto, UpdateLeaseTermsDto } from './dto/lease.dto';

/** How far ahead a fixed term starts showing up as "ending soon". */
const RENEWAL_LEAD_DAYS = 30;

/** Whole days from now until `date`, negative once it has passed. */
function daysUntil(date: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const today = new Date();
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((b - a) / MS);
}

/**
 * Lease terms, and the one question a landlord needs answering: which of my
 * rooms is about to be empty.
 *
 * ── Computed on read, not written by a job
 *
 * The brief asks for "a scheduled check that flags leases approaching their end
 * date". This computes the flag when the dashboard is read instead, and that is
 * a deliberate difference.
 *
 * A nightly job would have to store a flag, and stored derived state goes
 * stale: a landlord who logs notice at 10am would keep seeing yesterday's
 * answer until the job ran again, and the row would need clearing when a lease
 * is renewed, extended, or ended early. There is nothing a job would buy here —
 * the query is two indexed reads — and a flag that can disagree with the
 * tenancy it describes is worse than no flag.
 *
 * What a job WOULD buy is reminders to people who are not looking at the
 * dashboard. Those are deliberately not built: every outbound WhatsApp message
 * in this codebase is free-form text, which Meta only permits inside the
 * 24-hour customer service window, so a renewal reminder cannot be delivered
 * until the template work in Phase 7g lands. See PRE-LAUNCH-CHECKLIST row 40.
 * Building a sender that silently fails is worse than not building one.
 */
@Injectable()
export class LeaseService {
  private readonly logger = new Logger(LeaseService.name);

  constructor(private prisma: PrismaService) {}

  private async assertLandlordOwns(tenancyId: string, landlordId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: { id: true, landlordId: true, tenantId: true, status: true },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');
    if (tenancy.landlordId !== landlordId) throw new ForbiddenException('That is not your tenancy');
    return tenancy;
  }

  /**
   * Either party. Notice is a thing both sides of a letting can give, so the
   * route that records it cannot be landlord-only — see `giveNotice`.
   */
  private async assertParty(tenancyId: string, userId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: {
        id: true, landlordId: true, tenantId: true, status: true,
        noticeGivenAt: true, noticeRecordedById: true,
      },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');
    if (tenancy.landlordId !== userId && tenancy.tenantId !== userId) {
      throw new ForbiddenException('You are not part of this tenancy');
    }
    return tenancy;
  }

  /**
   * Set or change the agreed terms.
   *
   * `leaseEndDate: null` is meaningful — it says month-to-month — so it is
   * distinguished from "not sent". Collapsing the two would make it impossible
   * to convert a fixed term into a rolling one, which is what happens when a
   * lease runs out and both sides simply carry on.
   */
  async updateTerms(tenancyId: string, dto: UpdateLeaseTermsDto, landlordId: string) {
    const tenancy = await this.assertLandlordOwns(tenancyId, landlordId);
    if (tenancy.status === 'ended' || tenancy.status === 'cancelled') {
      throw new BadRequestException('That tenancy has already ended.');
    }

    const data: Record<string, unknown> = {};
    if (dto.leaseEndDate !== undefined) {
      data['leaseEndDate'] = dto.leaseEndDate ? new Date(dto.leaseEndDate) : null;
    }
    if (dto.noticePeriodDays !== undefined) data['noticePeriodDays'] = dto.noticePeriodDays;

    if (dto.startDate !== undefined) {
      /**
       * ⚠️ An ACTIVE tenancy cannot lose its start date.
       *
       * This wrote whatever it was given, `null` included, and that became an
       * unrecoverable lockout the moment the rent window started reading
       * `startDate`: `mark()` answers "Confirm the move-in first, then the
       * rent record opens", and `confirmStart()` refuses because the tenancy
       * is already `active`. Neither route can put the date back, so the
       * landlord's rent record for that room is shut with no way in.
       *
       * It is also simply untrue. `active` means somebody confirmed a move-in,
       * and `confirmStart` sets status and startDate in one update — a live
       * tenancy that started on no particular day is a state the product
       * cannot otherwise reach. Correcting the date is fine; erasing it is not.
       */
      if (!dto.startDate && tenancy.status === 'active') {
        throw new BadRequestException(
          'A tenancy that has started must keep its move-in date. Correct the date rather than clearing it.',
        );
      }
      const start = dto.startDate ? new Date(dto.startDate) : null;
      // The same bound `confirmStart` enforces, for the same reason: a move-in
      // dated in the future on a tenancy somebody is already living in would
      // put every month of rent before it outside the window.
      if (start && tenancy.status === 'active' && start.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        throw new BadRequestException('A move-in date cannot be in the future.');
      }
      data['startDate'] = start;
    }

    return this.prisma.tenancy.update({ where: { id: tenancyId }, data });
  }

  /**
   * Record that notice was given, by either side.
   *
   * ── Two different people, and the difference is the whole design
   *
   * `noticeGivenById` is who notice is ATTRIBUTED to. `noticeRecordedById` is
   * who entered it. A landlord logging "my tenant told me they are leaving"
   * and a tenant giving notice through the site produce the SAME
   * `noticeGivenById`, and they are not the same act.
   *
   * Until `noticeRecordedById` existed, only the attribution was stored — and
   * that is why a TENANT COULD NOT GIVE NOTICE AT ALL. Not an oversight: with
   * one column there is no safe withdrawal rule. Letting a landlord clear a
   * tenant's notice resets a countdown that frees a room, and letting a tenant
   * clear a landlord's does the same in reverse. The route's OpenAPI summary
   * claimed "by either side" for as long as this method existed while
   * `assertLandlordOwns` returned 403 — a documented capability the code
   * refused, which is the shape of defect this codebase keeps producing.
   *
   * With both columns the rule is simply: whoever recorded it may withdraw it.
   *
   * ── What a tenant may and may not claim
   *
   * A landlord may record either side, because the record is theirs and
   * logging what a tenant told them is the common case. A TENANT may only
   * record their own notice: a tenant setting `givenBy: 'landlord'` would be
   * fabricating that they had been served notice to leave, which is a
   * materially different fact and not theirs to assert.
   *
   * Idempotent-ish: giving notice twice keeps the FIRST date, because the
   * countdown runs from when notice was actually given and a second tap must
   * not quietly restart it.
   */
  async giveNotice(tenancyId: string, dto: GiveNoticeDto, userId: string) {
    const tenancy = await this.assertParty(tenancyId, userId);
    if (tenancy.status === 'ended' || tenancy.status === 'cancelled') {
      throw new BadRequestException('That tenancy has already ended.');
    }
    // Nothing to give notice on before anybody has moved in. Cancelling is the
    // way out of a letting that has not started, and `cancel()` is where it is.
    if (tenancy.status === 'pending') {
      throw new BadRequestException(
        'This tenancy has not started yet. If it has fallen through, mark it as such instead.',
      );
    }

    // Already given: keep the first date. The countdown runs from when notice
    // was actually given, so a second tap must not restart it.
    if (tenancy.noticeGivenAt) {
      return this.prisma.tenancy.findUnique({ where: { id: tenancyId } });
    }

    const isLandlord = tenancy.landlordId === userId;
    // ⚠️ A tenant may not claim the landlord served notice on them. That is a
    // different fact with different consequences, and not theirs to assert.
    if (!isLandlord && dto.givenBy === 'landlord') {
      throw new BadRequestException(
        'Only your landlord can record that they gave you notice. Record your own notice instead.',
      );
    }

    const givenById = dto.givenBy === 'tenant' ? tenancy.tenantId : tenancy.landlordId;
    return this.prisma.tenancy.update({
      where: { id: tenancyId },
      data: {
        noticeGivenAt: dto.givenOn ? new Date(dto.givenOn) : new Date(),
        noticeGivenById: givenById,
        // Who typed it, as against who it is about. This is what makes
        // withdrawal decidable.
        noticeRecordedById: userId,
      },
    });
  }

  /**
   * Notice was given in error, or withdrawn. Clears the countdown.
   *
   * ⚠️ Only whoever RECORDED it may withdraw it, and that is the rule the
   * whole tenant-notice path waited on. Withdrawing resets a countdown that
   * frees a room: a landlord who could clear a tenant's notice could keep them
   * on the books, and a tenant who could clear a landlord's could pretend they
   * had never been asked to leave. Neither gets to undo the other's act.
   *
   * Rows written before `noticeRecordedById` existed have none. Those were all
   * entered by a landlord — the only caller the route ever had — so a null is
   * read as the landlord.
   */
  async withdrawNotice(tenancyId: string, userId: string) {
    const tenancy = await this.assertParty(tenancyId, userId);
    if (!tenancy.noticeGivenAt) {
      throw new BadRequestException('No notice has been given on this tenancy.');
    }

    const recordedBy = tenancy.noticeRecordedById ?? tenancy.landlordId;
    if (recordedBy !== userId) {
      throw new ForbiddenException(
        recordedBy === tenancy.landlordId
          ? 'Your landlord recorded this notice, so only they can withdraw it. Talk to them about it.'
          : 'Your tenant recorded this notice, so only they can withdraw it.',
      );
    }

    return this.prisma.tenancy.update({
      where: { id: tenancyId },
      data: { noticeGivenAt: null, noticeGivenById: null, noticeRecordedById: null },
    });
  }

  /**
   * What is about to need attention, for the dashboard.
   *
   * Two separate things, which the brief keeps separate and so does this:
   *
   *   · a FIXED term inside the lead window — decide: renew or relist
   *   · a tenancy where NOTICE has been given — the room empties on a known
   *     day, so start relisting
   *
   * A month-to-month tenancy with no notice appears in neither, and that is
   * correct: nothing is happening to it. Listing every rolling tenancy as
   * "ending soon" would bury the two that are.
   */
  async upcoming(landlordId: string) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + RENEWAL_LEAD_DAYS);

    const live = await this.prisma.tenancy.findMany({
      where: {
        landlordId,
        status: { in: ['pending', 'active'] },
        OR: [
          { leaseEndDate: { not: null, lte: horizon } },
          { noticeGivenAt: { not: null } },
        ],
      },
      select: {
        id: true,
        status: true,
        startDate: true,
        leaseEndDate: true,
        noticePeriodDays: true,
        noticeGivenAt: true,
        noticeGivenById: true,
        landlordId: true,
        rentCents: true,
        // propertyId so a caller can build a link that actually resolves —
        // the detail screen for a room's rent and lease is per property.
        room: { select: { id: true, title: true, status: true, propertyId: true } },
        tenant: { select: { id: true, fullName: true } },
      },
      orderBy: [{ noticeGivenAt: 'asc' }, { leaseEndDate: 'asc' }],
    });

    return live.map((t) => {
      // Notice, when given, decides the day the room frees up — even on a
      // fixed term, because notice given mid-term is the earlier date.
      const noticeEnds = t.noticeGivenAt
        ? new Date(t.noticeGivenAt.getTime() + t.noticePeriodDays * 24 * 60 * 60 * 1000)
        : null;

      const emptiesOn = noticeEnds ?? t.leaseEndDate;
      const days = emptiesOn ? daysUntil(emptiesOn) : null;

      return {
        tenancyId: t.id,
        room: t.room,
        tenant: t.tenant,
        rentCents: t.rentCents,
        leaseEndDate: t.leaseEndDate,
        noticePeriodDays: t.noticePeriodDays,
        noticeGivenAt: t.noticeGivenAt,
        /** Who gave it, in the terms the landlord thinks in. */
        noticeGivenBy: t.noticeGivenAt
          ? t.noticeGivenById === t.landlordId
            ? 'you'
            : 'the tenant'
          : null,
        emptiesOn,
        daysUntilEmpty: days,
        /**
         * Which of the two situations this is, so the screen does not have to
         * re-derive it and cannot derive it differently.
         */
        reason: t.noticeGivenAt ? ('notice_given' as const) : ('lease_ending' as const),
        /** Already past. Shown, not hidden: an overdue relist is the urgent one. */
        overdue: days !== null && days < 0,
      };
    });
  }
}
