import {
  IsString, IsOptional, IsUUID, IsEnum, IsInt, IsUrl, IsDateString, IsEmail, Min, MaxLength, MinLength, IsIn,
  IsArray, ArrayMaxSize, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SA_PROVINCES } from '../../rooms/dto/room-filters.dto';

export class CreateAdvertiserDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) companyName!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) contactName!: string;
  @ApiProperty() @IsString() @MaxLength(255) contactEmail!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class CreateCampaignDto {
  @ApiProperty() @IsUUID() advertiserId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;

  @ApiProperty({ enum: ['board_sidebar', 'board_inline', 'room_detail'] })
  @IsEnum(['board_sidebar', 'board_inline', 'room_detail'])
  placement!: 'board_sidebar' | 'board_inline' | 'room_detail';

  @ApiProperty({ maxLength: 80 })
  @IsString() @MinLength(5) @MaxLength(80)
  headline!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  body?: string;

  @ApiPropertyOptional({ description: 'ImageKit path. Text-only ads are fine in a sidebar.' })
  @IsOptional() @IsString() @MaxLength(500)
  imagePath?: string;

  @ApiPropertyOptional({ default: 'Learn more' })
  @IsOptional() @IsString() @MaxLength(30)
  ctaLabel?: string;

  @ApiProperty({ description: 'Must be https — an ad linking over plain http is a trust problem.' })
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'The destination must be an https URL' })
  @MaxLength(500)
  targetUrl!: string;

  // Contextual targeting only. Omit for national reach.
  @ApiPropertyOptional({ enum: SA_PROVINCES })
  @IsOptional() @IsIn(SA_PROVINCES)
  province?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;

  @ApiPropertyOptional({
    description: 'Suburb slug from /places/suggest, e.g. johannesburg-sandton. Narrower than city.',
  })
  @IsOptional() @IsString() @MaxLength(120)
  suburbSlug?: string;

  @ApiPropertyOptional({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsOptional() @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType?: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;

  @ApiProperty({ description: 'Flat monthly rate in ZAR cents, e.g. 250000 for R2,500' })
  @IsInt() @Min(0)
  monthlyRateCents!: number;
}

/**
 * The pause / resume / end control for a campaign that is ALREADY approved.
 *
 * ⚠️ This was an inline body type — `@Body() body: { status: 'active' |
 * 'paused' | 'ended' }` — and an inline type carries no validation metadata,
 * so `ValidationPipe` had nothing to check and the union was decorative.
 * Measured: `{"status":"pending_review"}` was accepted and written,
 * `{"status":"not-a-real-status"}` reached Prisma and came back a 500, and an
 * empty body answered 200 having changed nothing.
 */
export class SetCampaignStatusDto {
  /**
   * `IsIn`, not `IsEnum`. `IsEnum` expects an enum object, and given an array
   * it validates correctly but cannot name the permitted values — the message
   * comes out as "status must be one of the following values: " with nothing
   * after the colon, which tells an admin nothing. (`ReviewCampaignDto` above
   * has the same wart; left alone here rather than widened into this change.)
   */
  @ApiProperty({ enum: ['active', 'paused', 'ended'] })
  @IsIn(['active', 'paused', 'ended'])
  status!: 'active' | 'paused' | 'ended';
}

/**
 * Impression beacon. Public and unauthenticated, so it is bounded.
 *
 * ⚠️ Also an inline body type before, which meant the ids were never checked
 * to be uuids and the array had no declared ceiling. The request body limit
 * refuses a very large one (measured: 5,000 ids → 413), but that is the body
 * parser protecting this route rather than the route protecting itself.
 */
export class RecordImpressionsDto {
  /**
   * ⚠️ A SHAPE match, not `IsUUID`, and it took two goes to get here.
   *
   * `IsUUID('4')` first — which looks stricter and is wrong. The seeded demo
   * campaigns carry deterministic ids like
   * `00000000-0000-0000-0000-0000000000b1`, so every impression from a board
   * showing a demo ad came back 400. Caught by `scripts/smoke-test.sh`, which
   * posts the id of a real seeded campaign; `ads.int-spec.ts` used a v4-shaped
   * placeholder and could not have seen it.
   *
   * `IsUUID()` with no version next, which also refused it: class-validator's
   * "all" still requires an RFC-4122 version nibble of 1-5 and a variant of
   * 8/9/a/b, and those ids are nil-uuid shaped. So NO `IsUUID` setting accepts
   * the application's own data.
   *
   * What this field needs is a bound on the input, not a certificate of
   * provenance: 8-4-4-4-12 hex is enough to keep rubbish away from a uuid
   * column, and the column itself is the real arbiter.
   */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    each: true,
    message: 'each value in campaignIds must look like a uuid',
  })
  campaignIds!: string[];
}

export class ReviewCampaignDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Required when rejecting.' })
  @IsOptional() @IsString() @MaxLength(500)
  rejectionReason?: string;
}

/**
 * Inbound enquiry from a business wanting to buy placement. Public, so it is
 * validated tightly and rate limited at the controller — an open contact form
 * is a spam magnet.
 */
export class CreateAdEnquiryDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) companyName!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) contactName!: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  contactEmail!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;

  @ApiPropertyOptional({ example: 'Fibre / ISP' })
  @IsOptional() @IsString() @MaxLength(80)
  industry?: string;

  @ApiProperty({ minLength: 20, maxLength: 2000 })
  @IsString()
  @MinLength(20, { message: 'Tell us a little about what you want to advertise' })
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ enum: SA_PROVINCES })
  @IsOptional() @IsIn(SA_PROVINCES)
  province?: string;
}

export class UpdateEnquiryDto {
  @ApiProperty({ enum: ['new', 'contacted', 'won', 'lost'] })
  @IsEnum(['new', 'contacted', 'won', 'lost'])
  status!: 'new' | 'contacted' | 'won' | 'lost';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) adminNotes?: string;
}
