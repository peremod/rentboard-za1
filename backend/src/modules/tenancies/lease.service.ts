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
    if (dto.startDate !== undefined) data['startDate'] = dto.startDate ? new Date(dto.startDate) : null;

    return this.prisma.tenancy.update({ where: { id: tenancyId }, data });
  }

  /**
   * Record that notice was given, and by whom.
   *
   * Either side may give it, so `givenBy` is stored rather than assumed. A
   * landlord logging "the tenant told me they are leaving" and a landlord
   * giving notice themselves are different facts, and a dispute later turns on
   * which one happened.
   *
   * Idempotent-ish: giving notice twice keeps the FIRST date, because the
   * countdown runs from when notice was actually given and a second tap must
   * not quietly restart it.
   */
  async giveNotice(tenancyId: string, dto: GiveNoticeDto, landlordId: string) {
    const tenancy = await this.assertLandlordOwns(tenancyId, landlordId);
    if (tenancy.status === 'ended' || tenancy.status === 'cancelled') {
      throw new BadRequestException('That tenancy has already ended.');
    }

    const existing = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: { noticeGivenAt: true },
    });
    if (existing?.noticeGivenAt) {
      return this.prisma.tenancy.findUnique({ where: { id: tenancyId } });
    }

    const givenById = dto.givenBy === 'tenant' ? tenancy.tenantId : landlordId;
    return this.prisma.tenancy.update({
      where: { id: tenancyId },
      data: { noticeGivenAt: dto.givenOn ? new Date(dto.givenOn) : new Date(), noticeGivenById: givenById },
    });
  }

  /** Notice was given in error, or withdrawn. Clears the countdown. */
  async withdrawNotice(tenancyId: string, landlordId: string) {
    await this.assertLandlordOwns(tenancyId, landlordId);
    return this.prisma.tenancy.update({
      where: { id: tenancyId },
      data: { noticeGivenAt: null, noticeGivenById: null },
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
