import { Controller, Post, Get, Body, Headers, HttpCode, HttpStatus, UseGuards, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
    @Body() payload: { type?: string; data?: { email_id?: string; to?: string[] } },
    @Headers('svix-signature') signature?: string,
  ) {
    // Verify when a signing secret is configured. Resend signs with Svix; an
    // unverified webhook would let anyone suppress any address, which is a
    // denial-of-service on somebody's account recovery.
    const secret = this.config.get<string>('resend.webhookSecret');
    if (secret && !signature) {
      throw new BadRequestException('Missing signature');
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
  @ApiOperation({ summary: 'Emails RentBoard has sent you — POPIA s.23 access right' })
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

  private async suppress(email: string, reason: 'hard_bounce' | 'complaint', detail: string) {
    await this.prisma.emailSuppression
      .upsert({ where: { email }, create: { email, reason, detail }, update: { reason, detail } })
      .catch(() => {});
    this.logger.warn(`Suppressed ${email} (${reason})`);
  }
}
