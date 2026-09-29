import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsOptional, IsString,
  MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceCategory } from '@prisma/client';

const CATEGORIES: ServiceCategory[] = ['plumber', 'electrician', 'locksmith', 'cleaner', 'other'];

export class CreateServiceProviderDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsEnum(CATEGORIES)
  category!: ServiceCategory;

  @ApiProperty({ example: 'Sipho — Tembisa Plumbing' })
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  /**
   * Accepted in whatever form the admin has it, normalised on the way in.
   *
   * 082 123 4567 and +27821234567 are one tradesperson, and a directory that
   * lists them twice is one nobody trusts. The service rejects anything that is
   * not a South African mobile rather than storing it unusable — a `tel:` link
   * built from a number that is not a number is a dead end in front of a
   * landlord with a burst pipe.
   */
  @ApiProperty({ example: '082 123 4567', description: 'Any SA mobile format; stored as +27…' })
  @IsString() @MinLength(9) @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ default: true, description: 'Whether this number is on WhatsApp.' })
  @IsOptional() @IsBoolean()
  whatsapp?: boolean;

  @ApiProperty({ type: [String], example: ['Tembisa', 'Kempton Park'] })
  @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(80, { each: true })
  areas!: string[];

  @ApiPropertyOptional({ example: 'Does geysers and blocked drains. Cash or EFT.' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ default: false, description: 'Off by default — see the schema note.' })
  @IsOptional() @IsBoolean()
  active?: boolean;

  /** Present for the future paid-placement line. Nothing reads it yet. */
  @ApiPropertyOptional()
  @IsOptional() @IsISO8601()
  sponsoredUntil?: string | null;
}

export class UpdateServiceProviderDto {
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsEnum(CATEGORIES)
  category?: ServiceCategory;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(9) @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  whatsapp?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(80, { each: true })
  areas?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  sponsoredUntil?: string | null;
}
