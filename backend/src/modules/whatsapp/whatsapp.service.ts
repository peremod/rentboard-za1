import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';

/**
 * WhatsApp Business API bridge (Meta Cloud API).
 * Landlords opt in with a phone number; RentBoard notifies them there when a
 * tenant applies or messages, and their replies flow back into the
 * application's in-app conversation thread via the webhook.
 *
 * This is a notification/reply bridge, not a full WhatsApp inbox — the
 * source of truth for a conversation is always the `Message` table.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiVersion: string;
  private readonly phoneNumberId?: string;
  private readonly accessToken?: string;
  private readonly verifyToken?: string;

  constructor(private config: ConfigService, private prisma: PrismaService) {
    this.apiVersion = this.config.get<string>('whatsapp.apiVersion') ?? 'v19.0';
    this.phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    this.accessToken = this.config.get<string>('whatsapp.accessToken');
    this.verifyToken = this.config.get<string>('whatsapp.verifyToken');
  }

  /** Landlord opts in / updates their notification number. */
  async updateConfig(landlordProfileId: string, dto: UpdateWhatsappConfigDto) {
    return this.prisma.landlordWhatsappConfig.upsert({
      where: { landlordId: landlordProfileId },
      create: { landlordId: landlordProfileId, phoneNumber: dto.phoneNumber, waEnabled: dto.waEnabled ?? true },
      update: { phoneNumber: dto.phoneNumber, ...(dto.waEnabled != null && { waEnabled: dto.waEnabled }) },
    });
  }

  getConfig(landlordProfileId: string) {
    return this.prisma.landlordWhatsappConfig.findUnique({ where: { landlordId: landlordProfileId } });
  }

  /**
   * Sends a plain-text notification to a landlord who has opted in.
   * Silently no-ops if the landlord hasn't configured WhatsApp — this is a
   * bonus channel on top of email, never the only notification sent.
   */
  async notifyLandlord(landlordProfileId: string, message: string): Promise<void> {
    const config = await this.getConfig(landlordProfileId);
    if (!config?.waEnabled) return;

    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn('WhatsApp API credentials not configured — skipping send (email notification still applies)');
      return;
    }

    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: config.phoneNumber.replace('+', ''),
          type: 'text',
          text: { body: message },
        }),
      });
      if (!res.ok) throw new Error(`WhatsApp API responded ${res.status}: ${await res.text()}`);

      await this.prisma.landlordWhatsappConfig.update({
        where: { landlordId: landlordProfileId },
        data: { totalMessagesSent: { increment: 1 } },
      });
    } catch (err) {
      this.logger.error('WhatsApp send failed — notification still delivered via email', err as Error);
      // Never throw — WhatsApp is a bonus channel; failure here must not fail the caller.
    }
  }

  /** GET /whatsapp/webhook — Meta's one-time verification handshake. */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode === 'subscribe' && token === this.verifyToken) return challenge;
    throw new BadRequestException('Webhook verification failed');
  }

  /**
   * POST /whatsapp/webhook — incoming message/status-update payloads from Meta.
   * A real reply is matched to its thread via the `context.id` field Meta
   * includes when a landlord replies to our outbound message; we store it as
   * a new Message on the matching Application if one can be found.
   *
   * NOTE: matching an inbound WhatsApp reply back to a specific Application
   * is only reliable once outbound sends record the resulting wamid against
   * a Message row — that wiring lands with the Applications API pass
   * (0.6.0/0.7.0). Until then this safely logs and no-ops on replies it
   * can't confidently match, rather than mis-filing a message.
   */
  async handleIncomingWebhook(body: any): Promise<void> {
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message) return; // status-update callback, not a new message — nothing to do

    const contextId = message.context?.id;
    if (!contextId) {
      this.logger.log(`Inbound WhatsApp message with no reply-context — cannot match to a thread, ignoring: ${message.id}`);
      return;
    }

    const originalMessage = await this.prisma.message.findUnique({ where: { waMessageId: contextId } });
    if (!originalMessage) {
      this.logger.log(`Inbound WhatsApp reply references unknown wamid ${contextId} — ignoring`);
      return;
    }

    await this.prisma.message.create({
      data: {
        applicationId: originalMessage.applicationId,
        senderId: originalMessage.senderId,
        channel: 'whatsapp',
        body: message.text?.body ?? '[unsupported message type]',
        waMessageId: message.id,
      },
    });
  }
}
