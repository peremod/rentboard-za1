import {
  IsString, IsOptional, IsUUID, IsEnum, IsInt, IsUrl, IsDateString, Min, MaxLength, MinLength, IsIn,
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

  @ApiPropertyOptional({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsOptional() @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType?: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;

  @ApiProperty({ description: 'Flat monthly rate in ZAR cents, e.g. 250000 for R2,500' })
  @IsInt() @Min(0)
  monthlyRateCents!: number;
}

export class ReviewCampaignDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Required when rejecting.' })
  @IsOptional() @IsString() @MaxLength(500)
  rejectionReason?: string;
}
