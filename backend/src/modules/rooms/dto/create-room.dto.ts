import { IsString, IsEnum, IsInt, Min, IsOptional, IsBoolean, IsDateString, MaxLength, MinLength, IsIn, IsArray, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SA_PROVINCES } from './room-filters.dto';

/**
 * Free-tier photo cap: 1 cover (heroImagePath) + 19 gallery photos
 * (imagePaths) = 20 total. Mirrors the frontend's PhotoUpload cap and
 * RoomsService.assertPhotoLimit() — three independent enforcement points
 * for the same stated limit, not just a UI-level suggestion.
 */
const MAX_GALLERY_PHOTOS = 19;

export class CreateRoomDto {
  @ApiProperty({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType!: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiProperty({ example: 'Spacious en-suite in Sandton professional house' })
  @IsString() @MinLength(10) @MaxLength(80)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @ApiProperty({ description: 'Monthly rent in ZAR cents, e.g. R5500 = 550000', example: 550000 })
  @IsInt() @Min(10000, { message: 'Rent must be at least R100/month' })
  rentCents!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) depositCents?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() billsIncluded?: boolean;

  @ApiProperty({ enum: SA_PROVINCES }) @IsIn(SA_PROVINCES) province!: string;
  @ApiProperty({ example: 'Sandton' }) @IsString() city!: string;
  @ApiProperty({ example: 'Sandton, Gauteng' }) @IsString() locationDisplay!: string;

  @ApiProperty() @IsDateString() availableFrom!: string;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) housematesCount?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() couplesAllowed?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() dssAccepted?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() guarantorAccepted?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() petsAllowed?: boolean;

  @ApiPropertyOptional({
    description: 'Amenity keys from the shared AMENITIES list.',
    example: ['shower_indoor', 'prepaid_electricity', 'furnished'],
  })
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(40)
  amenities?: string[];

  @ApiPropertyOptional({ description: 'ImageKit path — the room cover photo' })
  @IsOptional() @IsString() @MaxLength(500)
  heroImagePath?: string;

  @ApiPropertyOptional({ description: `Gallery photo paths, max ${MAX_GALLERY_PHOTOS} (20 total with the cover)`, type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_GALLERY_PHOTOS) @IsString({ each: true })
  imagePaths?: string[];
}
