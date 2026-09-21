import { Controller, Get, Post, Patch, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';

type Caller = { id: string; role: UserRole };

/**
 * Verification, for both sides of the market.
 *
 * LandlordGuard used to sit on submit and mine, which made the whole feature
 * landlord-only — a tenant could not submit anything, so the Renter's Passport
 * had no way to exist. The guard is gone and the service enforces the real
 * rule instead: each verification type declares whose it is
 * (verification.rules.ts), and submitting one that is not yours is a 400.
 * That is stricter than the guard was, not looser — the guard never checked
 * that a landlord was submitting a landlord's document.
 */
@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private verificationService: VerificationService) {}

  @Get('types')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The checks this account can submit, with guidance for each' })
  availableTypes(@CurrentUser() user: Caller) {
    return this.verificationService.availableTypes(user.role);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "This account's own checks, their status and their history" })
  listMine(@CurrentUser() user: Caller) {
    return this.verificationService.listMine(user.id);
  }

  @Get('mine/:id/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The audit trail for one of your own checks' })
  history(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: Caller) {
    return this.verificationService.history(id, user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a document, or a previous landlord, for checking' })
  submit(@Body() dto: SubmitVerificationDto, @CurrentUser() user: Caller) {
    return this.verificationService.submit(dto, user);
  }

  @Get('badge/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'What a badge is based on — which checks passed, and when',
    description:
      'Outcomes only. Never a document, never a rejection, never an admin note. A landlord reading "income proof: rejected" would be screening on a private failure, which is not what this is for.',
  })
  badgeBasis(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.verificationService.badgeBasis(userId);
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin review queue' })
  listPending() {
    return this.verificationService.listPending();
  }

  @Patch(':id/review')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject. The document is deleted either way.' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewVerificationDto,
    @CurrentUser() user: Caller,
  ) {
    return this.verificationService.review(id, dto, user.id);
  }
}
