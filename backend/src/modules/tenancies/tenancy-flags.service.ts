import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeText } from '../../common/utils/sanitize.util';
import { RaiseFlagDto } from './dto/raise-flag.dto';
import { ReviewFlagDto } from './dto/review-flag.dto';

/**
 * Post-tenancy dispute flags.
 *
 * Reviews already exist and are a different thing: a public star rating, open
 * for 30 days, written about a room or a person. This is a private report to
 * the platform that someone behaved badly — unpaid rent, a withheld deposit,
 * an unlawful eviction — which an admin acts on. Conflating the two would mean
 * a landlord who kept a deposit is answerable only through a star.
 *
 * **Reduced visibility, not suspension.** An open flag increments
 * `User.openFlagCount`, which pushes a landlord's rooms down the board and
 * marks the account in the admin queue. It does not hide listings, close
 * applications or touch a live tenancy. A flag is an untested allegation until
 * an admin reads it, and one angry party must not be able to take another's
 * livelihood off the board by filling in a form. Suspension already exists for
 * that, is reversible, and is an admin decision.
 *
 * **Not public.** Publishing "this landlord withheld my deposit" against a
 * named individual, unreviewed, is this platform's largest defamation exposure
 * in South Africa — the same reasoning that keeps a landlord's review of a
 * tenant a private reference rather than a public record.
 */
@Injectable()
export class TenancyFlagsService {
  private readonly logger = new Logger(TenancyFlagsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Raise a flag about the other party to a tenancy you were part of.
   *
   * `againstId` is derived from the tenancy rather than supplied, so nobody
   * can flag a stranger by guessing a user id — the only two people who can
   * flag each other are the two who were in the tenancy.
   */
  async raise(tenancyId: string, dto: RaiseFlagDto, userId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: { id: true, landlordId: true, tenantId: true, status: true },
    });
    if (!tenancy) throw new NotFoundException('No such tenancy');

    if (tenancy.landlordId !== userId && tenancy.tenantId !== userId) {
      throw new ForbiddenException('You were not part of that tenancy');
    }
    // Post-tenancy, as the name says. A dispute during a live tenancy is a
    // conversation, or in a bad case the Rental Housing Tribunal — not a
    // permanent mark raised while both parties still have to live with it.
    if (tenancy.status !== 'ended') {
      throw new BadRequestException(
        'A flag can only be raised once the tenancy has ended. If something is wrong now, message the other party — and for a deposit or eviction dispute, the Rental Housing Tribunal in your province hears these for free.',
      );
    }

    const againstId = tenancy.landlordId === userId ? tenancy.tenantId : tenancy.landlordId;

    const existing = await this.prisma.tenancyFlag.findUnique({
      where: { tenancyId_raisedById: { tenancyId, raisedById: userId } },
    });
    if (existing) {
      throw new BadRequestException(
        'You have already reported a problem with this tenancy. If there is more to add, reply to the email we sent you.',
      );
    }

    const flag = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenancyFlag.create({
        data: {
          tenancyId,
          raisedById: userId,
          againstId,
          reason: dto.reason,
          detail: sanitizeText(dto.detail),
        },
      });
      // Same transaction as the flag, so the counter cannot be incremented for
      // a flag that was not created, nor a flag land uncounted.
      await tx.user.update({
        where: { id: againstId },
        data: { openFlagCount: { increment: 1 } },
      });
      return created;
    });

    this.logger.log(`Tenancy flag raised on ${tenancyId} against ${againstId} (${dto.reason})`);
    return flag;
  }

  /** The flags this person raised, and the outcome of each. */
  listMine(userId: string) {
    return this.prisma.tenancyFlag.findMany({
      where: { raisedById: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, tenancyId: true, reason: true, detail: true,
        status: true, reviewNote: true, reviewedAt: true, createdAt: true,
      },
    });
  }

  /**
   * Withdraw a flag you raised, while it is still open.
   *
   * Exists because people cool off, and because a flag raised in anger that
   * cannot be taken back is a reason not to raise a real one.
   */
  async withdraw(id: string, userId: string) {
    const flag = await this.prisma.tenancyFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('No such report');
    if (flag.raisedById !== userId) throw new ForbiddenException('That is not your report');
    if (flag.status !== 'open') {
      throw new BadRequestException('That report has already been reviewed.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenancyFlag.update({
        where: { id },
        data: { status: 'withdrawn' },
      });
      await tx.user.update({
        where: { id: flag.againstId },
        data: { openFlagCount: { decrement: 1 } },
      });
      return updated;
    });
  }

  /** Admin queue, oldest first — a flag sitting unread is the thing to fix. */
  listOpen() {
    return this.prisma.tenancyFlag.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'asc' },
      include: {
        raisedBy: { select: { id: true, fullName: true, role: true } },
        against: { select: { id: true, fullName: true, role: true, openFlagCount: true } },
        tenancy: {
          select: {
            id: true, startDate: true, endDate: true, rentCents: true,
            room: { select: { id: true, title: true, locationDisplay: true } },
          },
        },
      },
    });
  }

  /**
   * Admin decision.
   *
   * `dismissed` decrements the counter immediately — visibility was reduced on
   * an allegation that did not hold, and leaving it reduced would make a
   * dismissed flag a punishment. `upheld` keeps it counted.
   */
  async review(id: string, dto: ReviewFlagDto, adminId: string) {
    const flag = await this.prisma.tenancyFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('No such report');
    if (flag.status !== 'open') throw new BadRequestException('That report has already been reviewed.');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenancyFlag.update({
        where: { id },
        data: {
          status: dto.status,
          reviewNote: dto.reviewNote,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
      if (dto.status === 'dismissed') {
        await tx.user.update({
          where: { id: flag.againstId },
          data: { openFlagCount: { decrement: 1 } },
        });
      }
      this.logger.log(`Tenancy flag ${id} ${dto.status} by admin ${adminId}`);
      return updated;
    });
  }

  /**
   * Recomputes every openFlagCount from the flags themselves.
   *
   * openFlagCount is denormalised so the board's ordering can use it in SQL.
   * It is maintained transactionally everywhere above, so it cannot drift from
   * a code path — but it can drift from a hand-edited row or a restored
   * backup, and a counter with no way to be put right is a counter that
   * quietly goes wrong. Admin-only, and safe to run at any time.
   */
  async recount() {
    const counts = await this.prisma.tenancyFlag.groupBy({
      by: ['againstId'],
      where: { status: { in: ['open', 'upheld'] } },
      _count: { _all: true },
    });
    const correct = new Map(counts.map((c) => [c.againstId, c._count._all]));

    const users = await this.prisma.user.findMany({
      where: { OR: [{ openFlagCount: { gt: 0 } }, { id: { in: [...correct.keys()] } }] },
      select: { id: true, openFlagCount: true },
    });

    const drifted = users.filter((u) => (correct.get(u.id) ?? 0) !== u.openFlagCount);
    for (const user of drifted) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { openFlagCount: correct.get(user.id) ?? 0 },
      });
    }

    if (drifted.length) this.logger.warn(`Corrected openFlagCount on ${drifted.length} account(s)`);
    return { checked: users.length, corrected: drifted.length };
  }
}
