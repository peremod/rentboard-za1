import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';
import { sanitizeText } from '../../common/utils/sanitize.util';
import { RespondToReferenceDto } from './dto/respond-to-reference.dto';

/** How long a referee has to answer before the link stops working. */
const TOKEN_TTL_DAYS = 14;

/**
 * Previous-landlord references.
 *
 * The referee is a stranger to this platform: no account, no password, and no
 * intention of making one. Asking them to register in order to answer one
 * question is how a reference never arrives, so they get a single WhatsApp
 * message with a one-time link, and that link is the entire authentication.
 *
 * Which makes the token the whole security model, so it is treated like one:
 *   - 32 random bytes from a CSPRNG, not a guessable id;
 *   - stored only as a sha256 hash, so a database leak cannot be used to
 *     answer references as the referee — the same reasoning as the refresh
 *     token;
 *   - single use, spent on first answer;
 *   - expires in 14 days, after which the reference is `unreachable`, which
 *     is not a negative signal about the tenant and must never be shown as
 *     one. Previous landlords are busy people.
 *
 * POPIA: the referee's name and number are a third party's personal
 * information, supplied by the tenant under s.11(1)(a) consent captured at
 * submission. The first message says who is asking and why, and offers a way
 * to decline — s.69 requires both.
 */
@Injectable()
export class ReferencesService {
  private readonly logger = new Logger(ReferencesService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private config: ConfigService,
  ) {}

  private hash(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Sends the reference request. Called by an admin from the review queue.
   *
   * Deliberately not automatic on submission: a message goes to a real person
   * who did not ask for it, and one look at the request first is what stops
   * this becoming a way to send strangers WhatsApp messages by typing their
   * number into a form.
   */
  async sendRequest(requestId: string, adminId: string) {
    const reference = await this.prisma.landlordReference.findUnique({
      where: { requestId },
      include: { request: { include: { user: { select: { fullName: true } } } } },
    });
    if (!reference) throw new NotFoundException('No reference on that request');
    if (reference.status === 'confirmed' || reference.status === 'disputed') {
      throw new BadRequestException('That referee has already answered.');
    }

    const phone = normaliseSaMobile(reference.refereePhone);
    if (!phone) throw new BadRequestException('That referee number is not a valid SA mobile.');

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const siteUrl = (this.config.get<string>('frontendUrl') ?? '').replace(/\/$/, '');
    const link = `${siteUrl}/reference/${token}`;

    const tenantName = reference.request.user.fullName;
    const property = reference.propertyDescription ? ` (${reference.propertyDescription})` : '';

    const delivered = await this.whatsapp.sendToNumber(
      phone,
      `Hello ${reference.refereeName}. This is Mastande, a room-letting notice board.\n\n` +
        `${tenantName} has given you as a previous landlord${property} and asked us to check the reference. ` +
        `Would you answer two questions about how the tenancy went?\n\n${link}\n\n` +
        `It takes about a minute and the link works once. If you would rather not answer, ignore this message — ` +
        `we will not message you again about it.`,
    );

    await this.prisma.$transaction([
      this.prisma.landlordReference.update({
        where: { requestId },
        data: {
          responseTokenHash: this.hash(token),
          tokenExpiresAt: expiresAt,
          contactedAt: new Date(),
          status: 'contacted',
        },
      }),
      this.prisma.verificationEvent.create({
        data: {
          requestId,
          actor: delivered ? 'system' : 'admin',
          actorId: adminId,
          step: delivered ? 'reference_sent' : 'reference_send_failed',
          detail: delivered
            ? `Reference request sent to ${reference.refereeName} on WhatsApp.`
            : `WhatsApp could not deliver to ${reference.refereeName} — phone them instead.`,
        },
      }),
    ]);

    this.logger.log(`Reference request for ${requestId} — delivered: ${delivered}`);
    return { delivered, expiresAt };
  }

  /**
   * What the referee sees before answering. No authentication but the token.
   *
   * Returns the tenant's name and what they said about the tenancy, because a
   * referee cannot answer "did they pay on time" without knowing who is being
   * asked about. Nothing else about the tenant is disclosed — not their email,
   * not their other references, not whether they have applied anywhere.
   */
  async lookup(token: string) {
    const reference = await this.prisma.landlordReference.findUnique({
      where: { responseTokenHash: this.hash(token) },
      include: { request: { include: { user: { select: { fullName: true } } } } },
    });
    if (!reference) throw new NotFoundException('That link is not valid.');
    if (reference.respondedAt) {
      throw new BadRequestException('Thank you — this reference has already been answered.');
    }
    if (!reference.tokenExpiresAt || reference.tokenExpiresAt < new Date()) {
      throw new BadRequestException('That link has expired.');
    }

    return {
      refereeName: reference.refereeName,
      tenantName: reference.request.user.fullName,
      propertyDescription: reference.propertyDescription,
      tenancyStartedAt: reference.tenancyStartedAt,
      tenancyEndedAt: reference.tenancyEndedAt,
    };
  }

  /**
   * The referee's answer. Spends the token.
   *
   * `declined` is a first-class outcome, not an absence. A referee who does
   * not want to vouch for someone must have a way to say so that is not
   * silence, and it is recorded as `disputed` rather than pretending the
   * message never arrived.
   */
  async respond(token: string, dto: RespondToReferenceDto) {
    const tokenHash = this.hash(token);
    const reference = await this.prisma.landlordReference.findUnique({ where: { responseTokenHash: tokenHash } });
    if (!reference) throw new NotFoundException('That link is not valid.');
    if (reference.respondedAt) {
      throw new BadRequestException('Thank you — this reference has already been answered.');
    }
    if (!reference.tokenExpiresAt || reference.tokenExpiresAt < new Date()) {
      throw new BadRequestException('That link has expired.');
    }

    const confirmed = dto.outcome === 'confirm';

    await this.prisma.$transaction(async (tx) => {
      await tx.landlordReference.update({
        where: { responseTokenHash: tokenHash },
        data: {
          status: confirmed ? 'confirmed' : 'disputed',
          rating: confirmed ? dto.rating : null,
          comment: dto.comment ? sanitizeText(dto.comment) : null,
          respondedAt: new Date(),
          // Spend it. A reference is answered once.
          responseTokenHash: null,
          tokenExpiresAt: null,
        },
      });
      await tx.verificationEvent.create({
        data: {
          requestId: reference.requestId,
          actor: 'system',
          step: confirmed ? 'reference_confirmed' : 'reference_declined',
          detail: confirmed
            ? `${reference.refereeName} confirmed the tenancy and rated it ${dto.rating}/5.`
            : `${reference.refereeName} did not confirm the tenancy.`,
        },
      });
    });

    this.logger.log(`Reference ${confirmed ? 'confirmed' : 'declined'} for request ${reference.requestId}`);
    return { recorded: true };
  }

  /**
   * Expires references nobody answered.
   *
   * `unreachable`, not `disputed`. A previous landlord who did not reply has
   * told us nothing about the tenant, and an admin reviewing the queue must
   * not read silence as a bad reference — which is exactly what would happen
   * if these sat at `contacted` forever.
   */
  async expireStale() {
    const stale = await this.prisma.landlordReference.findMany({
      where: { status: 'contacted', respondedAt: null, tokenExpiresAt: { lt: new Date() } },
      select: { requestId: true, refereeName: true },
    });
    if (stale.length === 0) return { expired: 0 };

    await this.prisma.$transaction([
      this.prisma.landlordReference.updateMany({
        where: { requestId: { in: stale.map((s) => s.requestId) } },
        data: { status: 'unreachable', responseTokenHash: null, tokenExpiresAt: null },
      }),
      this.prisma.verificationEvent.createMany({
        data: stale.map((s) => ({
          requestId: s.requestId,
          actor: 'system' as const,
          step: 'reference_unreachable',
          detail: `${s.refereeName} did not answer within ${TOKEN_TTL_DAYS} days. This says nothing about the tenant.`,
        })),
      }),
    ]);

    this.logger.log(`Expired ${stale.length} unanswered reference(s)`);
    return { expired: stale.length };
  }
}
