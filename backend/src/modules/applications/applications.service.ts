import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenanciesService } from '../tenancies/tenancies.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateApplicationDto } from './dto/create-application.dto';
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
    if (existing) throw new ConflictException('You have already applied for this room');

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

    await this.notifications.sendNewApplicationEmail(room.landlord.email, {
      landlordName: room.landlord.fullName,
      tenantName: tenant.fullName,
      roomTitle: room.title,
      applicationId: application.id,
    });
    if (room.landlord.landlordProfile) {
      await this.whatsapp.notifyLandlord(
        room.landlord.landlordProfile.id,
        `📬 New RentBoard application: ${tenant.fullName} applied for "${room.title}". Reply on the app to respond.`,
      );
    }

    return application;
  }

  /**
   * Returns active applications first, then closed ones. `isArchived` tells the
   * tenant an application ended because the room was relisted or let to someone
   * else, rather than leaving a stale 'pending' or 'accepted' on screen.
   */
  async getMyApplications(tenantId: string) {
    const applications = await this.prisma.application.findMany({
      where: { tenantId },
      include: { room: true },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
    });

    return applications.map((a) => ({
      ...a,
      isArchived: a.archivedAt !== null,
      // Only meaningful when archived; drives the label on the tenant card.
      archivedReason:
        a.archivedAt === null
          ? null
          : a.status === 'accepted'
            ? 'This tenancy ended and the room has been relisted.'
            : 'The landlord relisted this room, so this application was closed.',
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
      include: { tenant: { select: { id: true, fullName: true, email: true, avatarPath: true, isVerified: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
    await this.notifications.sendApplicationViewedEmail(tenant.email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      applicationId,
    });
    return updated;
  }

  async shortlist(applicationId: string, landlordId: string) {
    const application = await this.getOwnedApplication(applicationId, landlordId);
    this.assertNotDecided(application);

    const updated = await this.prisma.application.update({ where: { id: applicationId }, data: { status: 'shortlisted' } });

    const tenant = await this.prisma.user.findUniqueOrThrow({ where: { id: application.tenantId } });
    await this.notifications.sendShortlistedEmail(tenant.email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      applicationId,
    });
    return updated;
  }

  /**
   * Accepting an application auto-rejects every other still-open applicant
   * for the same room, with a considerate note — matches the behaviour
   * shown in the Sprint3 reference (RentBoard-Sprint3-Code.html).
   */
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

    await this.notifications.sendAcceptedEmail(tenant.email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      rentCents: application.room.rentCents,
      city: application.room.city,
    });

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
        data: { status: 'rejected', decidedAt: new Date() },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: application.tenantId } }),
    ]);

    await this.notifications.sendRejectionEmail(tenant.email, {
      tenantName: tenant.fullName,
      roomTitle: application.room.title,
      reason: dto.reason ? sanitizeText(dto.reason) : dto.reason,
      searchUrl: `${this.config.get<string>('frontendUrl')}/?province=${encodeURIComponent(application.room.province)}`,
    });
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
      await this.prisma.application.update({ where: { id: other.id }, data: { status: 'rejected', decidedAt: new Date() } });
      await this.notifications.sendRejectionEmail(other.tenant.email, {
        tenantName: other.tenant.fullName,
        roomTitle: other.room.title,
        reason,
        searchUrl: `${this.config.get<string>('frontendUrl')}/?province=${encodeURIComponent(other.room.province)}`,
      });
    }
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
