import { Controller, Post, Get, Body, Headers, HttpCode, HttpStatus, UseGuards, Logger, BadRequestException, ServiceUnavailableException, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/** Svix's own replay tolerance, and the reason a stale delivery is refused. */
const SVIX_TOLERANCE_SECONDS = 5 * 60;

/**
 * Resend delivery events, and the email log.
 *
 * The webhook is what closes the loop: without acting on bounces and
 * complaints, the sending domain's reputation degrades until legitimate mail —
 * including password resets — stops being delivered for everyone.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Post('webhook/resend')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async resendWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: { type?: string; data?: { email_id?: string; to?: string[] } },
    @Headers('svix-signature') signature?: string,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
  ) {
    // Resend signs with Svix; an unverified webhook lets anyone suppress any
    // address, which is a denial-of-service on somebody's account recovery.
    //
    // This used to check only that a signature HEADER WAS PRESENT and never
    // verify it, so `svix-signature: anything` passed — the exact hole the
    // comment warned about. crypto was imported for the verification and
    // never used, which is how it was found.
    const secret = this.config.get<string>('resend.webhookSecret');
    if (!secret) {
      // Fail closed. The tempting alternative — skip verification when no
      // secret is set, so local development is easy — means production
      // silently accepts forged events the moment the variable is missing,
      // which is the failure nobody notices. validateEnvironment now requires
      // RESEND_WEBHOOK_SECRET in production so this cannot happen there;
      // elsewhere, set it to exercise the endpoint.
      this.logger.error('Resend webhook received but RESEND_WEBHOOK_SECRET is not set; refusing it');
      throw new ServiceUnavailableException('Webhook verification is not configured');
    }
    if (!signature || !svixId || !svixTimestamp) {
      throw new BadRequestException('Missing signature');
    }
    if (!this.verifySvixSignature(secret, svixId, svixTimestamp, req.rawBody, signature)) {
      this.logger.warn(`Rejected Resend webhook with an invalid signature (svix-id ${svixId})`);
      throw new BadRequestException('Invalid signature');
    }

    const type = payload?.type ?? '';
    const providerId = payload?.data?.email_id;
    const recipient = payload?.data?.to?.[0]?.toLowerCase();
    if (!recipient) return { received: true };

    const now = new Date();

    if (type === 'email.delivered' && providerId) {
      await this.prisma.emailLog
        .updateMany({ where: { providerId }, data: { status: 'delivered', deliveredAt: now } })
        .catch(() => {});
    }

    if (type === 'email.bounced') {
      await this.prisma.emailLog
        .updateMany({ where: { providerId }, data: { status: 'bounced', bouncedAt: now } })
        .catch(() => {});
      // Hard bounce: the address does not exist. Stop sending to it.
      await this.suppress(recipient, 'hard_bounce', 'Resend reported a bounce');
    }

    if (type === 'email.complained') {
      await this.prisma.emailLog
        .updateMany({ where: { providerId }, data: { status: 'complained', complainedAt: now } })
        .catch(() => {});
      // Someone pressed "spam". Continuing to mail them is both rude and
      // damaging to deliverability for every other user.
      await this.suppress(recipient, 'complaint', 'Recipient marked as spam');
    }

    this.logger.log(`Resend event ${type} for ${recipient}`);
    return { received: true };
  }

  @Get('my-emails')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Emails Mastande has sent you — POPIA s.23 access right' })
  myEmails(@CurrentUser() user: { id: string }) {
    return this.prisma.emailLog.findMany({
      where: { userId: user.id },
      select: { id: true, subject: true, template: true, category: true, status: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('admin/failures')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recent delivery failures and suppressions' })
  async failures() {
    const [failed, suppressions] = await Promise.all([
      this.prisma.emailLog.findMany({
        where: { status: { in: ['failed', 'bounced', 'complained'] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.emailSuppression.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { failed, suppressions };
  }

  /**
   * Svix signature verification, as Resend documents it.
   *
   * The signed payload is `${id}.${timestamp}.${body}` where body is the exact
   * bytes received — hence rawBody in main.ts. The secret arrives as
   * `whsec_<base64>`; the base64 part decodes to the HMAC key, and the digest
   * is compared against the `v1,<sig>` entries in the header, of which there
   * may be several during a secret rotation.
   *
   * Written against the documented scheme rather than pulled in from the svix
   * package: this is one HMAC and a comparison, and it avoids a dependency
   * whose surface is far larger than the thing being used.
   */
  private verifySvixSignature(
    secret: string,
    svixId: string,
    svixTimestamp: string,
    rawBody: Buffer | undefined,
    header: string,
  ): boolean {
    if (!rawBody) {
      // rawBody: true is set in main.ts. If it is ever missing, failing closed
      // is the only safe answer — hashing the re-serialised body would produce
      // a digest that never matches anyway, but silently.
      this.logger.error('No raw body on the Resend webhook request; cannot verify');
      return false;
    }

    // Replay window. Svix's own tolerance is five minutes either side; without
    // it a captured-and-replayed delivery stays valid forever.
    const timestamp = Number(svixTimestamp);
    if (!Number.isFinite(timestamp)) return false;
    const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
    if (ageSeconds > SVIX_TOLERANCE_SECONDS) {
      this.logger.warn(`Rejected Resend webhook ${svixId}: timestamp ${Math.round(ageSeconds)}s out`);
      return false;
    }

    const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
    const expected = crypto
      .createHmac('sha256', key)
      // Fed as prefix-then-bytes rather than one interpolated string: the body
      // goes in exactly as received, with no decode/re-encode round trip.
      .update(`${svixId}.${svixTimestamp}.`)
      .update(rawBody)
      .digest();

    // The header is space-separated `v<version>,<base64>` pairs. Check every v1
    // entry: during a secret rotation Svix sends the payload signed with both
    // the old and the new secret, and only one of them will be ours.
    return header.split(' ').some((entry) => {
      const [version, value] = entry.split(',');
      if (version !== 'v1' || !value) return false;
      const candidate = Buffer.from(value, 'base64');
      // Length check first: timingSafeEqual throws on a mismatch rather than
      // returning false, and an attacker controls this length.
      return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    });
  }

  private async suppress(email: string, reason: 'hard_bounce' | 'complaint', detail: string) {
    await this.prisma.emailSuppression
      .upsert({ where: { email }, create: { email, reason, detail }, update: { reason, detail } })
      .catch(() => {});
    this.logger.warn(`Suppressed ${email} (${reason})`);
  }
}
