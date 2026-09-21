import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/**
 * WhatsApp Business API bridge (Meta Cloud API).
 * Landlords opt in with a phone number; Mastande notifies them there when a
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
  private readonly appSecret?: string;

  /**
   * Set by WhatsappModule after construction.
   *
   * A property rather than a constructor parameter because ListingBotService
   * has no dependency on this service but this one calls into it, and
   * injecting both ways is a circular dependency Nest resolves only with
   * forwardRef. One assignment in the module is clearer than that.
   */
  private listingBot?: { handleMessage(waId: string, message: unknown): Promise<string | null> };

  setListingBot(bot: { handleMessage(waId: string, message: unknown): Promise<string | null> }) {
    this.listingBot = bot;
  }

  constructor(private config: ConfigService, private prisma: PrismaService) {
    this.apiVersion = this.config.get<string>('whatsapp.apiVersion') ?? 'v19.0';
    this.phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    this.accessToken = this.config.get<string>('whatsapp.accessToken');
    this.verifyToken = this.config.get<string>('whatsapp.verifyToken');
    this.appSecret = this.config.get<string>('whatsapp.appSecret');
  }

  /**
   * Verifies Meta's X-Hub-Signature-256 over the exact bytes received.
   *
   * Until this existed, POST /whatsapp/webhook verified nothing at all. The
   * GET handshake checks a verify token, but that is a one-time exchange when
   * the URL is registered — it says nothing about any later delivery. So
   * anyone who found the URL could post a payload and have it written into a
   * landlord and tenant's private conversation as though the other party had
   * sent it. Phase 2 builds listing creation on this same webhook, which
   * would have meant anyone could create listings too.
   *
   * Meta's scheme: `sha256=<hex>` where the hex is HMAC-SHA256 of the raw
   * request body, keyed with the **App Secret** — App Dashboard, not the
   * access token and not the verify token.
   *
   * Raw bytes, not a re-serialised parse: hashing `JSON.stringify(parsed)`
   * gives a different digest whenever key order or number formatting differs,
   * which is most of the time. main.ts already sets `rawBody: true` for the
   * Resend webhook; this reuses it.
   */
  verifySignature(rawBody: Buffer | undefined, header?: string): boolean {
    if (!this.appSecret) {
      // Fail closed. The tempting alternative — skip verification when no
      // secret is configured, so local development is easy — means production
      // silently accepts forged deliveries the moment the variable is
      // missing, which is the failure nobody notices.
      this.logger.error('Inbound WhatsApp webhook but WHATSAPP_APP_SECRET is not set; refusing it');
      return false;
    }
    if (!rawBody || !header) return false;

    const [algorithm, signature] = header.split('=');
    if (algorithm !== 'sha256' || !signature) return false;

    const expected = crypto.createHmac('sha256', this.appSecret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }

    // Length first: timingSafeEqual throws on a mismatch rather than
    // returning false, and an attacker controls this length.
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
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
        body: `${code} is your Mastande sign-in code. It expires in ${ttlMinutes} minutes.\n\n` +
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

  /**
   * Sends a plain text message to any number, from the platform's own line.
   *
   * Used for the reference request in verification: the person receiving it
   * has no account and never will, so there is no config to look up and
   * notifyLandlord cannot be reused.
   *
   * Returns false rather than throwing when WhatsApp is unconfigured or the
   * send fails. A reference that cannot be delivered is not an error the
   * tenant should see — it falls back to an admin phoning the referee, which
   * is the documented path anyway — but the caller needs to know it did not
   * go, so it can say "we could not reach them" rather than "sent".
   */
  async sendToNumber(phone: string, message: string): Promise<boolean> {
    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn(`[WhatsApp not configured] message for ${phone}: ${message.slice(0, 120)}`);
      return false;
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace('+', ''),
        type: 'text',
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`WhatsApp send failed (${res.status}): ${detail.slice(0, 300)}`);
      return false;
    }
    return true;
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
      // No reply-context, so this is not part of an existing conversation.
      // It used to be dropped here. It is now offered to the listing bot,
      // which is how a landlord starts a listing by sending photos to the
      // number — see ListingBotService.
      //
      // Order matters: a reply to a thread must still be threaded, so the
      // bot only ever sees messages that were going to be discarded anyway.
      const waId: string | undefined = message.from ?? entry?.contacts?.[0]?.wa_id;
      if (!waId || !this.listingBot) {
        this.logger.log(`Inbound WhatsApp message with no reply-context and no sender — ignoring: ${message.id}`);
        return;
      }
      const reply = await this.listingBot.handleMessage(waId, message);
      if (reply) await this.sendToNumber(waId, reply);
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
