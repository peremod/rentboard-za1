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
      select: { id: true, landlordId: true, tenantId: true, status: true, rentCents: true },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');
    if (tenancy.landlordId !== landlordId) throw new ForbiddenException('That is not your tenancy');
    return tenancy;
  }

  /** The landlord's toggle. Creates the month on first use. */
  async mark(tenancyId: string, dto: MarkRentDto, landlordId: string) {
    const tenancy = await this.assertLandlord(tenancyId, landlordId);
    if (tenancy.status === 'cancelled') {
      throw new BadRequestException('That tenancy was cancelled — there is no rent to record.');
    }
    const periodStart = this.monthStart(dto.periodStart);

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
   */
  async dispute(periodId: string, dto: DisputeRentDto, tenantId: string) {
    const period = await this.prisma.rentPeriod.findUnique({
      where: { id: periodId },
      include: { tenancy: { select: { tenantId: true } } },
    });
    if (!period) throw new NotFoundException('No such rent record');
    if (period.tenancy.tenantId !== tenantId) throw new ForbiddenException('That is not your tenancy');
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

  /** Rent history for one tenancy. Either party may read their own. */
  async history(tenancyId: string, userId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: { landlordId: true, tenantId: true, rentCents: true },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');
    if (tenancy.landlordId !== userId && tenancy.tenantId !== userId) {
      throw new ForbiddenException('That is not your tenancy');
    }
    return this.prisma.rentPeriod.findMany({
      where: { tenancyId },
      orderBy: { periodStart: 'desc' },
      take: 24,
    });
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
