import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { SendMessageDto } from './dto/send-message.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/**
 * In-app conversation thread, one per Application. Every message also
 * triggers the recipient's other channels (email always; WhatsApp if the
 * recipient is a landlord who has opted in) — and for WhatsApp specifically,
 * the resulting wamid is recorded on the Message row so a landlord's reply
 * can be matched back to this exact thread by WhatsappService's webhook.
 */
@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  async getThread(applicationId: string, userId: string) {
    const application = await this.getParticipantApplication(applicationId, userId);
    return this.prisma.message.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async send(applicationId: string, senderId: string, dto: SendMessageDto) {
    // A closed application is a closed conversation. Without this, a landlord
    // who let the room weeks ago keeps receiving messages about it, and a
    // rejected tenant has no signal that the thread is over.
    const application = await this.getParticipantApplication(applicationId, senderId);

    if (application.archivedAt) {
      throw new BadRequestException(
        'This conversation is closed because the listing was relisted or removed. The thread stays readable.',
      );
    }
    if (application.status === 'rejected' || application.status === 'withdrawn') {
      throw new BadRequestException('This conversation is closed. The thread stays readable.');
    }

    const isTenantSending = senderId === application.tenantId;
    const recipient = isTenantSending ? application.room.landlord : application.tenant;
    const body = sanitizeText(dto.body);

    const message = await this.prisma.message.create({
      data: { applicationId, senderId, body, channel: 'rentboard' },
    });

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId } });
    const messagesUrl = `${this.config.get<string>('frontendUrl')}/${isTenantSending ? 'landlord' : 'tenant'}/dashboard`;

    await this.notifications.sendNewMessageEmail(recipient.email, {
      recipientName: recipient.fullName,
      senderName: sender.fullName,
      messagePreview: body.slice(0, 140),
      messagesUrl,
    });

    // Only tenant→landlord messages go out over WhatsApp — landlords are the
    // ones who opted a phone number in; tenants aren't notified over WhatsApp.
    if (isTenantSending && application.room.landlord.landlordProfile) {
      const wamid = await this.whatsapp.notifyLandlord(
        application.room.landlord.landlordProfile.id,
        `💬 ${sender.fullName}: ${body.slice(0, 300)}`,
      );
      if (wamid) {
        await this.prisma.message.update({ where: { id: message.id }, data: { waMessageId: wamid } });
      }
    }

    return message;
  }

  private async getParticipantApplication(applicationId: string, userId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { room: { include: { landlord: { include: { landlordProfile: true } } } }, tenant: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    const isParticipant = application.tenantId === userId || application.room.landlordId === userId;
    if (!isParticipant) throw new ForbiddenException('You are not part of this conversation');
    return application;
  }
}
