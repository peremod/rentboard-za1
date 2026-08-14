import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateApplicationDto } from './dto/create-application.dto';

/**
 * Minimal Applications module — covers "tenant applies" only, which is what
 * the notification chain (email + WhatsApp) added in this pass needs to be
 * end-to-end testable. Status transitions (viewed/shortlisted/accepted/
 * rejected) and the full applicant-manager UI land in pass 0.7.0 — the
 * NotificationsService methods for those (sendShortlistedEmail,
 * sendAcceptedEmail, sendRejectionEmail) already exist and are ready to wire
 * up then.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private whatsapp: WhatsappService,
  ) {}

  async create(dto: CreateApplicationDto, tenantId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      include: { landlord: { include: { landlordProfile: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'active') throw new BadRequestException('This room is no longer accepting applications');
    if (room.landlordId === tenantId) throw new ForbiddenException('You cannot apply to your own listing');

    const existing = await this.prisma.application.findUnique({
      where: { roomId_tenantId: { roomId: dto.roomId, tenantId } },
    });
    if (existing) throw new ConflictException('You have already applied for this room');

    const [application, tenant] = await Promise.all([
      this.prisma.application.create({
        data: { roomId: dto.roomId, tenantId, coverNote: dto.coverNote },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: tenantId } }),
    ]);

    await this.prisma.room.update({ where: { id: room.id }, data: { applicationCount: { increment: 1 } } });

    // Notify the landlord on every available channel — never let one failure block the other.
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

  getMyApplications(tenantId: string) {
    return this.prisma.application.findMany({
      where: { tenantId },
      include: { room: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
