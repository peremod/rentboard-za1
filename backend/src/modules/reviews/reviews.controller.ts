import { Controller, Get, Post, Patch, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { RespondToReviewDto } from './dto/respond-to-review.dto';

class ModerateReviewDto {
  @IsBoolean() isHidden!: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

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
  @UseGuards(JwtAuthGuard, LandlordGuard)
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
}
