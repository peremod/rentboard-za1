import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

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
   * Returns the resulting WhatsApp message ID (wamid) so the caller can
   * record it on a Message row — this is what lets a landlord's reply be
   * matched back to the right conversation thread by handleIncomingWebhook().
   */
  /**
   * Sends a sign-in code to a number directly, without a landlord config.
   *
   * Separate from notifyLandlord, which sends to a landlord's configured
   * number for their own listings. This goes to whoever is signing in, so it
   * uses the platform's own WhatsApp number.
   *
   * Throws rather than swallowing: unlike a notification, if the code does not
   * arrive the person cannot sign in, and silently succeeding would leave them
   * waiting for a message that is never coming.
   */
  async sendOtp(phone: string, code: string, ttlMinutes: number): Promise<void> {
    if (!this.phoneNumberId || !this.accessToken) {
      // In development this is the whole delivery mechanism, so log it rather
      // than leaving no way to test the flow at all.
      this.logger.warn(`[WhatsApp not configured] OTP for ${phone}: ${code}`);
      return;
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: phone.replace('+', ''),
      type: 'text',
      text: {
        body: `${code} is your RentBoard sign-in code. It expires in ${ttlMinutes} minutes.\n\n` +
              `If you did not ask to sign in, ignore this message and do not share the code.`,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`WhatsApp OTP failed (${res.status}): ${detail.slice(0, 300)}`);
      throw new Error('Could not send the code. Please try email instead.');
    }
  }

  async notifyLandlord(landlordProfileId: string, message: string): Promise<string | null> {
    const config = await this.getConfig(landlordProfileId);
    if (!config?.waEnabled) return null;

    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn('WhatsApp API credentials not configured — skipping send (email notification still applies)');
      return null;
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

      const data = await res.json();
      const wamid: string | null = data?.messages?.[0]?.id ?? null;

      await this.prisma.landlordWhatsappConfig.update({
        where: { landlordId: landlordProfileId },
        data: { totalMessagesSent: { increment: 1 } },
      });
      return wamid;
    } catch (err) {
      this.logger.error('WhatsApp send failed — notification still delivered via email', err as Error);
      // Never throw — WhatsApp is a bonus channel; failure here must not fail the caller.
      return null;
    }
  }

  /** GET /whatsapp/webhook — Meta's one-time verification handshake. */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode === 'subscribe' && token === this.verifyToken) return challenge;
    throw new BadRequestException('Webhook verification failed');
  }

  /**
   * POST /whatsapp/webhook — incoming message/status-update payloads from Meta.
   * A landlord's reply is matched to its thread via the `context.id` field
   * Meta includes when they reply to our outbound message — MessagesService
   * (added in pass 0.7.0) records that outbound wamid on the Message row it
   * created, which is what makes the lookup below succeed. Any reply whose
   * context.id we don't recognise (e.g. sent before this pass, or a fresh
   * WhatsApp conversation with no prior thread) is safely logged and
   * skipped rather than mis-filed into the wrong conversation.
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
        body: sanitizeText(message.text?.body ?? '[unsupported message type]'),
        waMessageId: message.id,
      },
    });
  }
}
