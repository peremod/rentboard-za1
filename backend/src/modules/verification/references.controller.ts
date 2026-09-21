import { Controller, Get, Post, Patch, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReferencesService } from './references.service';
import { RespondToReferenceDto } from './dto/respond-to-reference.dto';

/**
 * Previous-landlord references.
 *
 * Two of these routes are unauthenticated on purpose: the referee has no
 * account, and requiring one is how a reference never arrives. The one-time
 * token in the URL is the whole authentication — see ReferencesService for why
 * that is defensible and how the token is handled.
 *
 * Both are rate limited harder than the global default. The token is 32 random
 * bytes so guessing it is not a realistic attack, but an unauthenticated route
 * that takes an opaque string and tells you whether it exists is worth
 * throttling regardless.
 */
@ApiTags('verification')
@Controller('references')
export class ReferencesController {
  constructor(private references: ReferencesService) {}

  @Get('respond/:token')
  @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
  @ApiOperation({
    summary: 'What the referee sees before answering. No account needed.',
    description: 'Discloses the tenant\'s name and what they said about the tenancy — a referee cannot answer "did they pay on time" without it. Nothing else about the tenant is returned.',
  })
  lookup(@Param('token') token: string) {
    return this.references.lookup(token);
  }

  @Post('respond/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @ApiOperation({ summary: "The referee's answer. Spends the token." })
  respond(@Param('token') token: string, @Body() dto: RespondToReferenceDto) {
    return this.references.respond(token, dto);
  }

  @Post(':requestId/send')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Send the reference request over WhatsApp',
    description:
      'Admin-triggered, not automatic on submission: this messages a real person who did not ask for it, and one look at the request first is what stops the form becoming a way to send strangers WhatsApp messages.',
  })
  send(@Param('requestId') requestId: string, @CurrentUser() user: { id: string }) {
    return this.references.sendRequest(requestId, user.id);
  }

  @Patch('expire-stale')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark unanswered references unreachable. Safe to re-run.' })
  expireStale() {
    return this.references.expireStale();
  }
}
