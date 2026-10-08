import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/** Patterns that mean a person may be about to lose money, not just that a listing is poor. */
const URGENT_REASONS = ['upfront_payment_demanded', 'agent_posing_as_landlord', 'not_a_real_listing'];

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Anyone may report, signed in or not — a tenant who spots a scam mid-search
   * should not have to register first, and requiring an account suppresses
   * exactly the reports worth having.
   */
  async create(dto: CreateReportDto, reporterId?: string) {
    if (!dto.roomId && !dto.reportedUserId) {
      throw new BadRequestException('Tell us which listing or account this is about.');
    }
    if (!reporterId && !dto.contactEmail) {
      throw new BadRequestException('Please leave an email address so we can follow up.');
    }

    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (!room) throw new NotFoundException('That listing no longer exists.');
    }

    /**
     * ⚠️ A tenancy may only be attached by somebody who was IN it.
     *
     * The field is what makes "what went wrong during this letting" answerable,
     * and it is read by both parties' archive view — so an open field would
     * let anyone pin their complaint to a stranger's tenancy record, where
     * both of those people would then read it. Checked here rather than
     * trusted, because a report is the one thing in this product that is meant
     * to be taken seriously.
     *
     * A signed-out reporter has no tenancy to claim, which is why the check
     * requires `reporterId` and does not fall back to anything.
     */
    if (dto.tenancyId) {
      const tenancy = await this.prisma.tenancy.findUnique({
        where: { id: dto.tenancyId },
        select: { id: true, landlordId: true, tenantId: true },
      });
      if (!tenancy) throw new NotFoundException('That tenancy does not exist.');
      if (!reporterId || (tenancy.landlordId !== reporterId && tenancy.tenantId !== reporterId)) {
        throw new ForbiddenException('You can only report something about a letting you were part of.');
      }
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        roomId: dto.roomId,
        reportedUserId: dto.reportedUserId,
        // Null when the complaint is not about a particular letting, which is
        // the common case: most reports come from people browsing the board.
        tenancyId: dto.tenancyId,
        reason: dto.reason,
        details: sanitizeText(dto.details),
        contactEmail: dto.contactEmail?.trim().toLowerCase(),
      },
    });

    // Money-loss patterns are escalated rather than sitting in a queue.
    if (URGENT_REASONS.includes(dto.reason)) {
      this.logger.warn(`URGENT report ${report.id}: ${dto.reason} (room ${dto.roomId ?? '-'})`);
      this.notifications
        .sendUrgentReportAlert({ reportId: report.id, reason: dto.reason, roomId: dto.roomId })
        .catch(() => {});
    } else {
      this.logger.log(`Report ${report.id} filed: ${dto.reason}`);
    }

    // Never echo back what was stored — a reporter should not be able to probe
    // whether a given account exists by watching the response shape.
    return {
      id: report.id,
      message:
        'Thank you. Our team reviews reports within 24 hours. If you believe a crime has been committed, please also contact SAPS on 10111.',
    };
  }

  /** Admin queue. Open and investigating first, oldest first within each. */
  listForAdmin(status?: string) {
    return this.prisma.report.findMany({
      where: status ? { status: status as any } : { status: { in: ['open', 'investigating'] } },
      include: {
        room: { select: { id: true, title: true, status: true, locationDisplay: true, landlordId: true } },
        reporter: { select: { id: true, fullName: true, email: true } },
        reportedUser: { select: { id: true, fullName: true, email: true, isActive: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
  }

  /**
   * Counts of prior reports against the same room and landlord. A single
   * report is weak evidence; three about one landlord is the actual signal.
   */
  async getContext(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { room: { select: { landlordId: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');

    const subjectUserId = report.reportedUserId ?? report.room?.landlordId;

    const [sameRoom, sameUser] = await Promise.all([
      report.roomId
        ? this.prisma.report.count({ where: { roomId: report.roomId, id: { not: reportId } } })
        : 0,
      subjectUserId
        ? this.prisma.report.count({
            where: {
              id: { not: reportId },
              OR: [{ reportedUserId: subjectUserId }, { room: { landlordId: subjectUserId } }],
            },
          })
        : 0,
    ]);

    return { priorReportsOnRoom: sameRoom, priorReportsOnUser: sameUser };
  }

  async resolve(id: string, dto: ResolveReportDto, adminId: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');

    return this.prisma.report.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });
  }
}
