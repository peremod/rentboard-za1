import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { sanitizeText } from '../../common/utils/sanitize.util';

/**
 * The one sentence every phone-code entry point says while the channel is off.
 *
 * ⚠️ One constant, not six copies. Six copies drift, and the first thing a
 * person reads when a door is shut is the only explanation they get — it has
 * to name the alternative, not just the refusal.
 *
 * It deliberately does NOT say "WhatsApp is too expensive". Why the channel is
 * off is Umastande's business; what a person needs is the way in that works.
 */
export const PHONE_CODES_OFF =
  'Signing in with a phone number is not available yet. Use your email address — ' +
  'and if you do not have one on your account, ask us to add it.';

/**
 * The body of a Cloud API send, as it goes on the wire.
 *
 * Exported and pure so the SHAPE can be asserted without Meta, a network or a
 * running API — see scripts/whatsapp-template-drive.mjs. The alternative is a
 * check that only runs against live credentials, which in practice means a
 * check that never runs.
 */
export interface OtpSendOptions {
  phone: string;
  code: string;
  ttlMinutes: number;
  /** Approved AUTHENTICATION template name, or undefined if there is none yet. */
  templateName?: string;
  /** The template's language code, exactly as it was approved — e.g. en, en_US. */
  templateLang?: string;
}

/**
 * Build the outbound body for a sign-in code.
 *
 * ── Why there are two shapes at all
 *
 * Meta permits free-form `type: 'text'` ONLY inside the 24-hour customer
 * service window — within 24 hours of the person messaging the business. A
 * sign-in code goes to somebody who has not messaged us, by definition, so in
 * production it is always business-initiated and always outside the window.
 * Meta rejects it with error 131047 unless it uses a pre-approved template.
 *
 * So the text branch is NOT a fallback that works a bit less well. Against real
 * credentials it does not deliver at all. It stays because it is the right
 * thing in development, where no credentials are set and the code is logged
 * rather than sent, and because an operator mid-setup should get Meta's own
 * error rather than a silent no-op from us.
 *
 * ── The authentication template's shape is fixed by Meta, not by us
 *
 * An AUTHENTICATION template has preset body text with one variable (the code),
 * an optional expiry footer, and a required one-time-password button. The code
 * is passed TWICE — once to the body, which is what the person reads, and once
 * to the button, which is what the copy-code button puts on their clipboard.
 * Leaving the button parameter out is the common mistake; the message is then
 * rejected rather than sent without a button.
 *
 * ⚠️ `ttlMinutes` does NOT appear in the payload. The expiry is baked into the
 * template's footer at approval time (`code_expiration_minutes`), so it is a
 * number Meta already holds. It stays in the signature because the text branch
 * does use it, and because a caller passing a TTL that the template contradicts
 * is a real mistake worth being able to see — see OUTSTANDING §27.
 */
export function buildOtpSend(opts: OtpSendOptions): Record<string, unknown> {
  const to = opts.phone.replace('+', '');

  if (opts.templateName) {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: opts.templateName,
        language: { code: opts.templateLang ?? 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: opts.code }] },
          {
            type: 'button',
            // 'url' even for a copy-code button: the sub_type names the button
            // SLOT in the send request, while copy-code vs one-tap is fixed on
            // the template itself (otp_type) when it is created.
            sub_type: 'url',
            // A string, not the number 0. Meta's examples use "0" and a number
            // is rejected by some API versions.
            index: '0',
            parameters: [{ type: 'text', text: opts.code }],
          },
        ],
      },
    };
  }

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      body:
        `${opts.code} is your Mastande sign-in code. It expires in ${opts.ttlMinutes} minutes.\n\n` +
        `If you did not ask to sign in, ignore this message and do not share the code.`,
    },
  };
}

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
   * The master switch — Phase 8j. False means no Cloud API call is ever made.
   *
   * ⚠️ Read it through `enabled` rather than inlining the config lookup. One
   * place to check is one place to get wrong, and this gate is the difference
   * between a bill and no bill.
   */
  private readonly enabled: boolean;
  private readonly otpTemplate?: string;
  private readonly templateLang: string;
  /**
   * Where the Cloud API lives.
   *
   * Configurable for one reason: it is the only way to prove, in this
   * repository, that what we put on the wire is what Meta expects. Every send
   * path here was written against documentation and NONE of it had ever been
   * observed — scripts/whatsapp-template-drive.mjs points this at a stub and
   * reads the body. It defaults to Meta and an operator never sets it.
   */
  private readonly graphBase: string;

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
    this.enabled = this.config.get<boolean>('whatsapp.enabled') === true;
    this.apiVersion = this.config.get<string>('whatsapp.apiVersion') ?? 'v19.0';
    this.phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    this.accessToken = this.config.get<string>('whatsapp.accessToken');
    this.verifyToken = this.config.get<string>('whatsapp.verifyToken');
    this.appSecret = this.config.get<string>('whatsapp.appSecret');
    this.otpTemplate = this.config.get<string>('whatsapp.otpTemplate');
    this.templateLang = this.config.get<string>('whatsapp.templateLang') ?? 'en';
    this.graphBase = (
      this.config.get<string>('whatsapp.graphBaseUrl') ?? 'https://graph.facebook.com'
    ).replace(/\/$/, '');

    // Said once, at boot, where an operator reads it — not per message.
    //
    // Credentials set with no template is the state that looks configured and
    // delivers nothing: every sign-in code is business-initiated, so Meta
    // rejects all of them with 131047. The old code could not say this because
    // it had no notion of a template at all.
    // Said once, at boot, where an operator reads it. Which of the two lines
    // appears is the whole state of the channel.
    if (!this.enabled) {
      this.logger.log(
        'WhatsApp is OFF (WHATSAPP_ENABLED is not "true"). No message is sent and nothing is billed. ' +
          'Phone sign-in refuses with a 503 that says so; email and the magic link are unaffected. ' +
          'wa.me share links are not affected either — Meta does not bill for those.',
      );
    } else if (this.phoneNumberId && this.accessToken && !this.otpTemplate) {
      this.logger.warn(
        'WhatsApp credentials are set but WHATSAPP_TEMPLATE_OTP is not. Sign-in codes will be sent as ' +
          'free-form text, which Meta accepts only inside the 24-hour customer service window — so in ' +
          'practice they will be REJECTED (131047). Submit an AUTHENTICATION template and set its name.',
      );
    }
  }

  /**
   * Is the paid channel on at all?
   *
   * Public because the auth endpoints have to refuse BEFORE issuing a code
   * rather than issuing one nobody can receive: a code that exists, counts
   * against the attempt budget and is never delivered is worse than a plain
   * refusal, and it is exactly the kind of control this codebase keeps
   * shipping — one that looks like it works.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** The Cloud API messages endpoint for the configured number. */
  private messagesUrl(): string {
    return `${this.graphBase}/${this.apiVersion}/${this.phoneNumberId}/messages`;
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
    // ⚠️ Throws rather than returning quietly, and that is the point of the
    // whole switch. A sign-in code that is silently not sent leaves somebody
    // staring at a box waiting for a message that is never coming. The callers
    // check isEnabled() first and refuse before a code is ever issued; this is
    // the backstop for a caller that forgets.
    if (!this.enabled) {
      throw new Error('WhatsApp is switched off (WHATSAPP_ENABLED), so no sign-in code was sent.');
    }
    if (!this.phoneNumberId || !this.accessToken) {
      // In development this is the whole delivery mechanism, so log it rather
      // than leaving no way to test the flow at all.
      this.logger.warn(`[WhatsApp not configured] OTP for ${phone}: ${code}`);
      return;
    }

    const body = buildOtpSend({
      phone,
      code,
      ttlMinutes,
      templateName: this.otpTemplate,
      templateLang: this.templateLang,
    });

    const res = await fetch(this.messagesUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      // ⚠️ Meta's own error text, not a summary of it. 131047 ("re-engagement
      // message") and 132001 ("template name does not exist") are different
      // problems with different fixes, and an operator who sees neither has to
      // guess which. The code is also never logged — it is a credential.
      this.logger.error(
        `WhatsApp OTP failed (${res.status}) sending a ` +
          `${this.otpTemplate ? `template "${this.otpTemplate}" (${this.templateLang})` : 'free-form text message'}: ` +
          detail.slice(0, 300),
      );
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
    // false, not a throw: every caller treats false as "it did not go" and has
    // another route — an in-app notice, an email, or an admin phoning. Those
    // paths were already written to degrade, which is why switching the
    // channel off costs them nothing but the WhatsApp copy.
    if (!this.enabled) return false;
    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn(`[WhatsApp not configured] message for ${phone}: ${message.slice(0, 120)}`);
      return false;
    }

    const res = await fetch(this.messagesUrl(), {
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
    // null is this method's own "did not send" value, and the email
    // notification beside it is unaffected. Checked before the database read,
    // because a query to decide not to send is a query for nothing.
    if (!this.enabled) return null;
    const config = await this.getConfig(landlordProfileId);
    if (!config?.waEnabled) return null;

    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn('WhatsApp API credentials not configured — skipping send (email notification still applies)');
      return null;
    }

    try {
      const res = await fetch(this.messagesUrl(), {
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
    // Refused while the channel is off, so a webhook cannot be registered
    // against a deployment that will not answer it. Meta retries a failed
    // handshake rather than silently subscribing.
    if (!this.enabled) throw new BadRequestException('WhatsApp is not enabled on this deployment');
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
    // Nothing inbound is processed either. An inbound message is free to
    // receive, but acting on one means REPLYING — the listing bot answers
    // every message it accepts — and a reply is a service message Meta bills
    // for once the monthly free tier is gone.
    if (!this.enabled) {
      this.logger.log('Inbound WhatsApp delivery ignored — WHATSAPP_ENABLED is not set');
      return;
    }
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

    const originalMessage = await this.prisma.message.findUnique({
      where: { waMessageId: contextId },
      include: {
        application: {
          select: { id: true, tenantId: true, room: { select: { landlordId: true } } },
        },
      },
    });
    if (!originalMessage) {
      this.logger.log(`Inbound WhatsApp reply references unknown wamid ${contextId} — ignoring`);
      return;
    }

    /**
     * Who actually sent this — Phase 7c.
     *
     * ⚠️ This was `senderId: originalMessage.senderId`, and that is the id of
     * the person whose message we FORWARDED to WhatsApp — the tenant. So every
     * reply a landlord typed into WhatsApp was stored in the thread as though
     * the tenant had written it. The tenant then opened the conversation and
     * read the landlord's answer attributed to themselves, and the landlord saw
     * their own reply apparently coming from the applicant. Nothing errored, so
     * nothing surfaced it; the only reason it is visible now is that Phase 7c
     * builds an inbox that has to say who each message is from.
     *
     * The sender is resolved from the NUMBER the reply came from, which is the
     * only trustworthy signal here: the landlord opted that number in, and
     * LandlordWhatsappConfig maps it to their profile. A reply from any other
     * number is dropped rather than guessed at — a webhook that can be made to
     * write into somebody else's conversation by quoting a wamid is a hole, not
     * a convenience.
     */
    const from = (message.from ?? entry?.contacts?.[0]?.wa_id ?? '').replace(/\D/g, '');
    const config = from
      ? await this.prisma.landlordWhatsappConfig.findFirst({
          // Stored with a +, arriving without one. Compared on digits.
          where: { phoneNumber: { endsWith: from.slice(-9) } },
          select: { phoneNumber: true, landlord: { select: { userId: true } } },
        })
      : null;

    const senderId = config?.landlord?.userId ?? null;
    if (!senderId) {
      this.logger.warn(
        `Inbound WhatsApp reply from an unrecognised number for application ${originalMessage.applicationId} — dropped rather than attributed to a guess`,
      );
      return;
    }

    // And that person has to be in this conversation. A landlord replying to a
    // quoted wamid from somebody else's thread would otherwise be written into
    // it under their own name, which is worse than the bug above, not better.
    const app = originalMessage.application;
    if (senderId !== app.room.landlordId && senderId !== app.tenantId) {
      this.logger.warn(
        `WhatsApp reply from ${senderId} does not belong to application ${app.id} — dropped`,
      );
      return;
    }

    await this.prisma.message.create({
      data: {
        applicationId: originalMessage.applicationId,
        senderId,
        channel: 'whatsapp',
        body: sanitizeText(message.text?.body ?? '[unsupported message type]'),
        waMessageId: message.id,
      },
    });
  }
}
