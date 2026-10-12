import { Controller, Get, Post, Patch, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ListerGuard } from '../../common/guards/lister.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { ReviewsRelease } from './reviews.release';
import { CreateReviewDto } from './dto/create-review.dto';
import { RespondToReviewDto } from './dto/respond-to-review.dto';

class ModerateReviewDto {
  @IsBoolean() isHidden!: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(
    private reviewsService: ReviewsService,
    private reviewsRelease: ReviewsRelease,
  ) {}

  // ── Public ───────────────────────────────────────────────────────────────

  @Get('room/:roomId')
  @ApiOperation({ summary: 'Published reviews of a room' })
  roomReviews(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.reviewsService.getRoomReviews(roomId);
  }

  @Get('landlord/:landlordId')
  @ApiOperation({ summary: 'Published reviews of a landlord' })
  landlordReviews(@Param('landlordId', ParseUUIDPipe) landlordId: string) {
    return this.reviewsService.getLandlordReviews(landlordId);
  }

  // ── Restricted ───────────────────────────────────────────────────────────

  @Get('tenant/:tenantId/references')
  @UseGuards(JwtAuthGuard, ListerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'References for a prospective tenant',
    description:
      'Only available while that person has a live application on one of your rooms. Tenant reviews are references, not a public record.',
  })
  tenantReferences(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.reviewsService.getTenantReferences(tenantId, user.id);
  }

  // ── Authenticated ────────────────────────────────────────────────────────

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reviews you have written and received' })
  mine(@CurrentUser() user: { id: string }) {
    return this.reviewsService.getMine(user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Write a review. Held until both sides submit or the window closes.' })
  create(@Body() dto: CreateReviewDto, @CurrentUser() user: { id: string }) {
    return this.reviewsService.create(dto, user.id);
  }

  @Post(':id/respond')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reply to a review about you. One reply, and it does not change the rating.' })
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondToReviewDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.reviewsService.respond(id, dto, user.id);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Patch(':id/moderate')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hide or restore a review' })
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.reviewsService.setHidden(id, dto.isHidden, dto.reason, admin.id);
  }

  /**
   * Run the nightly pass now.
   *
   * ⚠️ Why an operator route for a cron.
   *
   * `ReviewsRelease.releaseClosedWindows` runs at 03:00 SAST and does two
   * things nobody can otherwise observe: it publishes reviews whose window has
   * closed, and it sets `Tenancy.archivedAt`. A job with no way to trigger it
   * cannot be driven, cannot be checked after a deploy, and cannot be re-run
   * when it fails — so the only evidence it works is that nobody has
   * complained, which is how this codebase ended up with a rent-reminder
   * control on a screen with no route.
   *
   * The precedent is `POST /properties/rent/run-reminders`, which exists for
   * the same reason and is admin-only for the same reason: it publishes
   * ratings, and that is not a button for a landlord with an opinion about a
   * tenant's review.
   *
   * Safe to re-run. Both passes are `updateMany` over rows that are not yet
   * done, so a second call is a no-op.
   */
  @Post('release-closed')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Admin: publish reviews whose window has closed and archive those tenancies. Safe to re-run.',
  })
  releaseClosed() {
    return this.reviewsRelease.releaseClosedWindows();
  }
}
