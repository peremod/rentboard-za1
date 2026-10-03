import {
  IsOptional, IsString, MaxLength, MinLength, IsArray, IsUUID, ArrayMaxSize,
  IsEnum, IsInt, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HousemateProfile } from '@prisma/client';

/**
 * The shared-living fields, on both create and update.
 *
 * A class the two DTOs extend rather than two copies: this project has been
 * bitten by duplicated definitions drifting apart more than once, and a
 * validation rule that exists twice is one that will eventually disagree with
 * itself about what a landlord may type.
 */
export class SharedLivingDto {
  @ApiPropertyOptional({
    example: 'Gate locked at 21:00. No visitors overnight without telling me first.',
    description: "Free text, in the landlord's own words — a checklist would replace the rules that matter with generic ones.",
  })
  @IsOptional() @IsString() @MaxLength(2000)
  houseRules?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Shared kitchen', 'Outside tap', 'Washing line', 'Locked gate'],
    description: 'What everyone at this address uses. Not Room.amenities, which is what comes with one room.',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(60, { each: true })
  sharedAmenities?: string[];

  @ApiPropertyOptional({
    example: 4,
    description: 'People already living at the address, across all rooms. Omit if not saying.',
  })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  currentHousemates?: number;

  @ApiPropertyOptional({ enum: ['professionals', 'students', 'mixed', 'couples', 'unstated'] })
  @IsOptional() @IsEnum(['professionals', 'students', 'mixed', 'couples', 'unstated'])
  housemateProfile?: HousemateProfile;
}

export class CreatePropertyDto extends SharedLivingDto {
  @ApiProperty({
    example: 'Ext 7 back rooms',
    description: "The landlord's own words — they have to recognise it in a list at a glance.",
  })
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Tembisa' })
  @IsOptional() @IsString() @MaxLength(120)
  suburb?: string;

  @ApiPropertyOptional({
    example: '1423 Vilakazi Street',
    description:
      "Optional, and visible to nobody but the landlord — Phase 7b. It exists so somebody with four yards can tell them apart in a list; the board still shows the suburb and never the street. Not returned in any public payload.",
  })
  @IsOptional() @IsString() @MaxLength(200)
  addressLine?: string;

  @ApiProperty({ example: 'Johannesburg' })
  @IsString() @MinLength(2) @MaxLength(120)
  city!: string;

  @ApiProperty({ example: 'Gauteng' })
  @IsString() @MinLength(2) @MaxLength(120)
  province!: string;
}

export class UpdatePropertyDto extends SharedLivingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  suburb?: string;

  /** Private to the landlord — see CreatePropertyDto.addressLine. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  city?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  province?: string;
}

export class AssignRoomsDto {
  @ApiProperty({
    type: [String],
    description:
      'Rooms to move into this yard. Every id must belong to the caller — one that does not fails the whole call rather than being silently skipped, so a typo is visible instead of half-applied.',
  })
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  roomIds!: string[];
}
