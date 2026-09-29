import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { LeaseDocumentKind } from '@prisma/client';

/**
 * 20MB. A lease photographed on a phone is 2–5MB and a scanned multi-page PDF
 * is rarely past 10; the ceiling is here so a mistaken upload of a video does
 * not sit in storage forever with the platform promising to look after it.
 *
 * It is a declared size, not a measured one — the bytes go browser-to-ImageKit
 * and never through this API. So it is a sanity bound on the claim, and the
 * real limit is ImageKit's own.
 */
export const LEASE_DOC_MAX_BYTES = 20 * 1024 * 1024;

export class AddLeaseDocumentDto {
  @ApiProperty({ description: 'ImageKit filePath, no leading slash' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  path!: string;

  @ApiProperty({ description: 'What to call it in the list' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional({ enum: LeaseDocumentKind, default: 'lease' })
  @IsOptional()
  @IsEnum(LeaseDocumentKind)
  kind?: LeaseDocumentKind;

  @ApiPropertyOptional({ description: 'Bytes, as the browser reported them' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LEASE_DOC_MAX_BYTES)
  sizeBytes?: number;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Partial. Never the path — replacing the file is an add plus a remove, so the
 *  old bytes are queued for deletion rather than orphaned by an overwrite. */
export class UpdateLeaseDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ enum: LeaseDocumentKind })
  @IsOptional()
  @IsEnum(LeaseDocumentKind)
  kind?: LeaseDocumentKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
