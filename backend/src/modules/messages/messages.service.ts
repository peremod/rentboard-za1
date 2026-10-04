import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { NoticeRouter } from '../notifications/notice-router.service';
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
    private notice: NoticeRouter,
  ) {}

  async getThread(applicationId: string, userId: string) {
    const application = await this.getParticipantApplication(applicationId, userId);

    /**
     * Opening a thread marks the other side's messages read — Phase 7c.
     *
     * ⚠️ `Message.readAt` has been on the model since messaging shipped and
     * NOTHING ever wrote it. A column called readAt that no code sets is the
     * same defect as a `documentDeletedAt` that deletes nothing and a
     * `MAX_ATTEMPTS` nobody reads: it tells the next person a feature exists.
     * Any "unread" badge built on it would have counted every message ever
     * sent, for ever.
     *
     * Only the OTHER party's messages: marking your own read is meaningless,
     * and would make the unread count on the other side depend on whether you
     * had looked at your own words.
     *
     * Not awaited for the read itself — the thread is returned either way. A
     * failure here must not stop somebody reading their messages, and the worst
     * case is a badge that stays up until the next time they open it.
     */
    this.prisma.message
      .updateMany({
        where: { applicationId: application.id, senderId: { not: userId }, readAt: null },
        data: { readAt: new Date() },
      })
      .catch(() => {});

    return this.prisma.message.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Every conversation this person is in, newest activity first — Phase 7c.
   *
   * ── Why it exists
   *
   * Messages were reachable only inside one application, at
   * `applications/:applicationId/messages`. A landlord with six rooms and
   * eleven applicants had seventeen places to look for "did anybody reply",
   * and the brief asks for one. It serves both sides: a tenant with four
   * applications had the same problem in miniature.
   *
   * ── Why the channel is in the payload
   *
   * Because the brief is right that replying in the wrong channel is a real
   * confusion risk rather than an edge case. A tenant's message is forwarded to
   * the landlord over WhatsApp; if the landlord replies there, the webhook
   * threads it back and it lands here as `whatsapp`. So one conversation
   * genuinely mixes channels, and the only way a landlord can tell where their
   * last answer went is for the list to say so.
   */
  async inbox(userId: string) {
    const applications = await this.prisma.application.findMany({
      // Both sides, in one query: the landlord of the room, or the tenant who
      // applied. Scoped in the WHERE, as everything here is.
      where: {
        OR: [{ tenantId: userId }, { room: { landlordId: userId } }],
        messages: { some: {} },
      },
      select: {
        id: true,
        status: true,
        archivedAt: true,
        tenantId: true,
        tenant: { select: { id: true, fullName: true, avatarPath: true } },
        room: {
          select: {
            id: true, title: true, landlordId: true,
            landlord: { select: { id: true, fullName: true, avatarPath: true } },
          },
        },
        messages: {
          select: { id: true, senderId: true, body: true, channel: true, createdAt: true, readAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const threads = applications.map((a) => {
      const iAmLandlord = a.room.landlordId === userId;
      const other = iAmLandlord ? a.tenant : a.room.landlord;
      const last = a.messages[0];
      const unread = a.messages.filter((m) => m.senderId !== userId && !m.readAt).length;

      return {
        applicationId: a.id,
        status: a.status,
        /** A closed conversation stays readable; the UI says so rather than hiding it. */
        closed: !!a.archivedAt || a.status === 'rejected' || a.status === 'withdrawn',
        room: { id: a.room.id, title: a.room.title },
        withName: other.fullName,
        withAvatarPath: other.avatarPath,
        iAmLandlord,
        unread,
        messageCount: a.messages.length,
        lastMessage: {
          body: last.body.slice(0, 160),
          channel: last.channel,
          createdAt: last.createdAt,
          fromMe: last.senderId === userId,
        },
        /**
         * Which channel the last thing anybody said arrived on, and whether the
         * conversation has used more than one. The UI warns on the second case:
         * a landlord who answered the last message in WhatsApp and is now
         * typing here is about to send to a different place from the one they
         * last used, and nothing else on the screen would tell them.
         */
        channelsUsed: [...new Set(a.messages.map((m) => m.channel))],
      };
    });

    threads.sort((x, y) => y.lastMessage.createdAt.getTime() - x.lastMessage.createdAt.getTime());

    return {
      data: threads,
      total: threads.length,
      unreadThreads: threads.filter((t) => t.unread > 0).length,
    };
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
      data: { applicationId, senderId, body, channel: 'in_app' },
    });

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId } });
    const messagesUrl = `${this.config.get<string>('frontendUrl')}/${isTenantSending ? 'landlord' : 'tenant'}/dashboard`;

    await this.notice.deliver(recipient, {
      kind: 'new_message',
      title: `${sender.fullName} sent you a message`,
      body: body.slice(0, 140),
      link: `/${isTenantSending ? 'landlord' : 'tenant'}/dashboard`,
    }, (email) => this.notifications.sendNewMessageEmail(email, {
      recipientName: recipient.fullName,
      senderName: sender.fullName,
      messagePreview: body.slice(0, 140),
      messagesUrl,
    }));

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
