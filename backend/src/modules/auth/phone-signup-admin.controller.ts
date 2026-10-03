import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneSignupService } from './phone-signup.service';

/**
 * The sign-up queue: visible, and prunable on demand.
 *
 * ── Why this exists rather than trusting the cron
 *
 * The same reason /admin/storage exists. `pruneAbandoned` runs daily and
 * deletes the mobile numbers of people who started a sign-up and never
 * finished — which is a POPIA promise about other people's data, made by a
 * scheduled job that nobody can see run. "It is on a cron" was precisely the
 * standard of proof behind the deletion claim this codebase had to go back and
 * make true.
 *
 * So the counts are readable, and the prune can be triggered, which also lets
 * scripts/phone-signup-drive.mjs prove the retention rule instead of naming it
 * as a skip.
 *
 * ── Counts only
 *
 * Never a number, never a name. How many attempts are outstanding and how old
 * the oldest is answers the retention question; whose numbers they are does not
 * make the answer any truer, and this is a table of people who did NOT sign up.
 */
@ApiTags('admin')
@Controller('admin/phone-signups')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class PhoneSignupAdminController {
  constructor(
    private prisma: PrismaService,
    private signups: PhoneSignupService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Sign-ups in flight, and anything kept longer than it should be',
  })
  async status() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
    const [inFlight, overdue, completed, oldest] = await Promise.all([
      this.prisma.phoneSignup.count({ where: { userId: null } }),
      // The retention breach, if there is one: abandoned and older than the
      // day the prune is supposed to keep them for.
      this.prisma.phoneSignup.count({ where: { userId: null, createdAt: { lt: dayAgo } } }),
      this.prisma.phoneSignup.count({ where: { userId: { not: null } } }),
      this.prisma.phoneSignup.findFirst({
        where: { userId: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      inFlight,
      overdue,
      /** Completed sign-ups. These are consent records and are kept. */
      completed,
      oldestInFlight: oldest?.createdAt ?? null,
      note:
        overdue > 0
          ? 'Abandoned sign-ups are being kept longer than a day. Each one is the mobile number of somebody who never joined — run the prune and check the schedule is firing.'
          : 'Nothing is being kept longer than it should be.',
    };
  }

  @Post('prune')
  @ApiOperation({
    summary: 'Throw away abandoned sign-ups now',
    description:
      'Deletes attempts older than 24 hours that never became an account. Completed sign-ups are consent records and are never touched.',
  })
  prune() {
    return this.signups.pruneAbandoned();
  }
}
