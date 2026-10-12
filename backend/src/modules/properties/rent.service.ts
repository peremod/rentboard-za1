import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { sanitizeText } from '../../common/utils/sanitize.util';
import { normaliseSaMobile } from '../../common/utils/phone.util';
import { MarkRentDto, DisputeRentDto, RentSettingsDto } from './dto/rent.dto';

/**
 * Rent tracking — a record, not a payment system.
 *
 * The landlord is already collecting rent by EFT, in cash or through a banking
 * app. What they do not have is a list of who is behind. So this is a toggle
 * and a reminder, and nothing touches money: putting Mastande between a
 * landlord and their rent would change what this product is, and would make
 * the platform a party to every dispute about whether a payment arrived.
 *
 * **Mastande does not assert that anyone owes anything.** A period is one
 * party's unverified word about the other, which shapes two things:
 *
 *   - the reminder says "your landlord has marked this unpaid", never "you
 *     owe" — a wrongly-flipped toggle must not turn into the platform
 *     telling someone they are in debt;
 *   - the tenant can dispute, and the dispute sits beside the landlord's
 *     record rather than overwriting it. Without that, a tenant receives an
 *     accusation over WhatsApp with no way to answer it.
 */
@Injectable()
export class RentService {
  private readonly logger = new Logger(RentService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
  ) {}

  /**
   * First of the month, midnight UTC.
   *
   * Normalised because the unique constraint is on [tenancyId, periodStart]:
   * two rows for "September" differing by a timezone offset would defeat it,
   * and a landlord would end up with two Septembers disagreeing about whether
   * rent arrived.
   */
  private monthStart(date: string | Date): Date {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('That is not a valid date.');
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  private async assertLandlord(tenancyId: string, landlordId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      // startDate and endDate come back because the window they describe is
      // what bounds a rent period — see assertRentWindow. Selecting only the
      // status is what allowed a landlord to record rent for a month the
      // tenant did not live there.
      select: {
        id: true, landlordId: true, tenantId: true, status: true, rentCents: true,
        startDate: true, endDate: true,
      },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');
    if (tenancy.landlordId !== landlordId) throw new ForbiddenException('That is not your tenancy');
    return tenancy;
  }

  /**
   * Whether a month may be written against this tenancy at all.
   *
   * ── Why this is a window and not a status check
   *
   * `mark()` refused `cancelled` and nothing else. So on a tenancy that had
   * ENDED a landlord could still mark months, and on any tenancy they could
   * mark a month before the tenant moved in, a month after they moved out, or
   * next March — `upsert` would happily create the row, with `amountCents`
   * snapshotted from a tenancy that was not running.
   *
   * The invariant is not "the tenancy is active". It is **a rent period
   * belongs to the months the tenancy actually covered**, which is true of a
   * finished letting as much as a live one. That distinction matters, because
   * refusing every write on an `ended` tenancy would break the most ordinary
   * thing there is: a tenant moves out on the 30th owing that month, and the
   * landlord records it on the 5th. Freezing the ledger at the moment of
   * move-out would make the record wrong in the one case it is most needed.
   *
   * So: the months of the letting stay writable; everything outside them does
   * not.
   */
  private assertRentWindow(
    tenancy: { status: string; startDate: Date | null; endDate: Date | null },
    periodStart: Date,
  ) {
    if (tenancy.status === 'cancelled') {
      throw new BadRequestException('That tenancy was cancelled — there is no rent to record.');
    }
    // `pending` means nobody has confirmed the move-in, so there is no month
    // to be in arrears on. The tenant's rent screen has always said exactly
    // this — "Your move-in is not confirmed yet, so there is no rent record" —
    // while the API accepted the write anyway.
    if (tenancy.status === 'pending' || !tenancy.startDate) {
      throw new BadRequestException(
        'This tenancy has not started yet. Confirm the move-in first, then the rent record opens.',
      );
    }

    const firstMonth = this.monthStart(tenancy.startDate);
    if (periodStart < firstMonth) {
      throw new BadRequestException(
        'That month is before the tenant moved in, so it is not part of this tenancy.',
      );
    }

    // Not the future. Rent is due at the start of a month, so the CURRENT
    // month is fair game; the one after it has not begun.
    const thisMonth = this.monthStart(new Date());
    if (periodStart > thisMonth) {
      throw new BadRequestException('That month has not started yet.');
    }

    if (tenancy.endDate) {
      const lastMonth = this.monthStart(tenancy.endDate);
      if (periodStart > lastMonth) {
        throw new BadRequestException(
          'That month is after the tenancy ended, so it is not part of this tenancy.',
        );
      }
    }
  }

  /**
   * The landlord's toggle. Creates the month on first use.
   *
   * A finished letting is still correctable — see assertRentWindow for why
   * that is deliberate rather than an oversight.
   */
  async mark(tenancyId: string, dto: MarkRentDto, landlordId: string) {
    const tenancy = await this.assertLandlord(tenancyId, landlordId);
    const periodStart = this.monthStart(dto.periodStart);
    this.assertRentWindow(tenancy, periodStart);

    return this.prisma.rentPeriod.upsert({
      where: { tenancyId_periodStart: { tenancyId, periodStart } },
      create: {
        tenancyId,
        periodStart,
        status: dto.status,
        amountCents: tenancy.rentCents,
        markedAt: new Date(),
        markedById: landlordId,
      },
      update: {
        status: dto.status,
        markedAt: new Date(),
        markedById: landlordId,
        // Marking it unpaid again re-arms the reminder. Without this, a
        // landlord who marked paid by mistake and corrected it would never
        // get a reminder sent for that month.
        ...(dto.status === 'unpaid' ? { reminderSentAt: null } : {}),
      },
    });
  }

  /**
   * The tenant's side.
   *
   * Recorded, not authoritative: it does not change the landlord's status.
   * The point is that a tenant who receives "your landlord has marked
   * September unpaid" has somewhere to say "I paid it on the 3rd" that the
   * landlord will actually see, rather than only a WhatsApp reply into a
   * thread about a room.
   *
   * Disputing also stops further reminders for that month — continuing to
   * chase someone who has said they paid is how a reminder becomes harassment.
   *
   * ⚠️ An ENDED tenancy is deliberately still disputable, and this is the one
   * place where "the letting is over, so lock it" would be actively harmful.
   * The most consequential rent mark a tenant will ever receive is the final
   * month, entered after they moved out — and `TenancyFlag.unpaid_rent` can be
   * raised off the back of it. Taking away the tenant's answer at exactly that
   * moment would leave the landlord's unverified word as the only record.
   *
   * So the window that bounds `mark()` does not bound this: whatever months
   * exist may be answered, whenever.
   */
  async dispute(periodId: string, dto: DisputeRentDto, tenantId: string) {
    const period = await this.prisma.rentPeriod.findUnique({
      where: { id: periodId },
      include: { tenancy: { select: { tenantId: true, status: true } } },
    });
    if (!period) throw new NotFoundException('No such rent record');
    if (period.tenancy.tenantId !== tenantId) throw new ForbiddenException('That is not your tenancy');
    // A cancelled letting never ran, so there is nothing to disagree about.
    // It should hold no periods either — assertRentWindow refuses to create
    // them — and this is the belt to that brace.
    if (period.tenancy.status === 'cancelled') {
      throw new BadRequestException('That tenancy was cancelled — there is no rent record to answer.');
    }
    if (period.status === 'paid') {
      throw new BadRequestException('That month is already marked paid — there is nothing to dispute.');
    }

    return this.prisma.rentPeriod.update({
      where: { id: periodId },
      data: {
        tenantDisputedAt: new Date(),
        tenantNote: dto.note ? sanitizeText(dto.note) : null,
        // Stops the reminder job picking it up again.
        reminderSentAt: new Date(),
      },
    });
  }

  /**
   * Rent history for one tenancy. Either party may read their own.
   *
   * ── Why this returns an envelope and not a bare array
   *
   * It used to answer `RentPeriod[]`, which meant a caller holding a rent
   * ledger could not tell whether the letting behind it was running, waiting
   * on a move-in, or finished two years ago. The tenant's rent screen read
   * that array and rendered an ended tenancy exactly like a current one —
   * present-tense heading, "/mo" rent figure, live actions — because the only
   * other way to know was a second request it did not make.
   *
   * A screen cannot describe a record it has not been told the state of. So
   * the state travels with the record.
   */
  async history(tenancyId: string, userId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: {
        id: true, landlordId: true, tenantId: true, rentCents: true,
        status: true, startDate: true, endDate: true, reviewsCloseAt: true,
      },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');
    if (tenancy.landlordId !== userId && tenancy.tenantId !== userId) {
      throw new ForbiddenException('That is not your tenancy');
    }

    const periods = await this.prisma.rentPeriod.findMany({
      where: { tenancyId },
      orderBy: { periodStart: 'desc' },
      take: 24,
    });

    return {
      tenancy: {
        id: tenancy.id,
        status: tenancy.status,
        startDate: tenancy.startDate,
        endDate: tenancy.endDate,
        rentCents: tenancy.rentCents,
        reviewsCloseAt: tenancy.reviewsCloseAt,
      },
      periods,
    };
  }

  async updateSettings(dto: RentSettingsDto, landlordId: string) {
    await this.prisma.landlordProfile.updateMany({
      where: { userId: landlordId },
      data: { rentGraceDays: dto.rentGraceDays },
    });
    return { rentGraceDays: dto.rentGraceDays };
  }

  /**
   * Reminds tenants whose landlord has marked this month unpaid.
   *
   * 09:00 SAST, once a day. Not hourly: a reminder about rent is not urgent
   * enough to justify the chance of arriving at 3am, and once a day is the
   * most anyone should be chased about the same month — which the
   * `reminderSentAt` guard enforces anyway.
   *
   * Only verified numbers. `User.phone` is typed in by the person and nobody
   * has checked it; sending "your landlord says your rent is unpaid" to an
   * unverified number is sending it to whoever actually holds that number.
   */
  @Cron('0 9 * * *', { timeZone: 'Africa/Johannesburg' })
  async sendOverdueReminders() {
    // ⚠️ Phase 8j. Stop before the loop, and the reason is in the data rather
    // than in the message.
    //
    // `reminderSentAt` is stamped on every candidate whether or not the send
    // succeeded. With the channel off that would mark EVERY unpaid month as
    // reminded while nothing was sent — and the stamp is what excludes a
    // period from the next pass, so those months would never be reminded
    // again, including after WhatsApp is switched back on. A silent, permanent
    // hole, created by a feature flag.
    //
    // Returning here leaves `reminderSentAt` null, so the work simply resumes.
    if (!this.whatsapp.isEnabled()) {
      this.logger.log('Rent reminders skipped — WHATSAPP_ENABLED is not set, so nothing was marked as reminded');
      return { sent: 0, skipped: 0, considered: 0 };
    }
    const now = new Date();
    const thisMonth = this.monthStart(now);

    const candidates = await this.prisma.rentPeriod.findMany({
      where: {
        status: 'unpaid',
        reminderSentAt: null,
        tenantDisputedAt: null,
        periodStart: { lte: thisMonth },
        tenancy: { status: 'active' },
      },
      include: {
        tenancy: {
          select: {
            id: true,
            tenant: { select: { id: true, fullName: true, phone: true, phoneVerified: true } },
            landlord: {
              select: { fullName: true, landlordProfile: { select: { rentGraceDays: true } } },
            },
            room: { select: { title: true } },
          },
        },
      },
      take: 500,
    });

    let sent = 0;
    let skipped = 0;

    for (const period of candidates) {
      const graceDays = period.tenancy.landlord.landlordProfile?.rentGraceDays ?? 3;
      // 0 turns reminders off for that landlord without turning off tracking.
      if (graceDays === 0) { skipped++; continue; }

      const due = new Date(period.periodStart);
      due.setUTCDate(due.getUTCDate() + graceDays);
      if (now < due) { skipped++; continue; }

      const tenant = period.tenancy.tenant;
      const phone = tenant.phoneVerified && tenant.phone ? normaliseSaMobile(tenant.phone) : null;
      if (!phone) {
        // No verified number: mark it handled so the job does not re-scan the
        // same row every night forever. The landlord still sees it unpaid.
        await this.prisma.rentPeriod.update({
          where: { id: period.id },
          data: { reminderSentAt: new Date() },
        });
        skipped++;
        continue;
      }

      const month = period.periodStart.toLocaleString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const amount = `R${(period.amountCents / 100).toFixed(2)}`;

      // Wording matters more than usual here. Mastande has not checked
      // anything — this is the landlord's record, and the message says so,
      // names them, and points at the way to disagree.
      const delivered = await this.whatsapp.sendToNumber(
        phone,
        `Hello ${tenant.fullName}. A reminder from Mastande about ${period.tenancy.room.title}.\n\n` +
          `${period.tenancy.landlord.fullName} has marked ${month} rent (${amount}) as not yet received.\n\n` +
          `If you have already paid, say so on Mastande and they will see it — ` +
          `we have not checked anything ourselves, this is their record.\n\n` +
          `Reply STOP to stop these reminders.`,
      );

      await this.prisma.rentPeriod.update({
        where: { id: period.id },
        data: { reminderSentAt: new Date() },
      });
      if (delivered) sent++; else skipped++;
    }

    if (sent || skipped) this.logger.log(`Rent reminders: ${sent} sent, ${skipped} skipped`);
    return { sent, skipped, considered: candidates.length };
  }
}
