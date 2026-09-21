import { IsOptional, IsString, MaxLength, MinLength, IsArray, IsUUID, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePropertyDto {
  @ApiProperty({
    example: 'Ext 7 back rooms',
    description: "The landlord's own words — they have to recognise it in a list at a glance.",
  })
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Tembisa' })
  @IsOptional() @IsString() @MaxLength(120)
  suburb?: string;

  @ApiProperty({ example: 'Johannesburg' })
  @IsString() @MinLength(2) @MaxLength(120)
  city!: string;

  @ApiProperty({ example: 'Gauteng' })
  @IsString() @MinLength(2) @MaxLength(120)
  province!: string;
}

export class UpdatePropertyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  suburb?: string;

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
