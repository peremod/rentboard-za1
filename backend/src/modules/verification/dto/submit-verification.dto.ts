import {
  IsEnum, IsString, IsOptional, MaxLength, MinLength,
  ValidateNested, IsISO8601, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationType } from '@prisma/client';

const TYPES: VerificationType[] = [
  'identity', 'proof_of_address', 'proof_of_ownership',
  'sassa_grant', 'employer_confirmation', 'bank_statement', 'landlord_reference',
];

/**
 * A previous landlord, named by the tenant.
 *
 * The referee has no account and is not asked to make one — a previous
 * landlord asked to register in order to answer one question is a reference
 * that never arrives. They get one WhatsApp message with a one-time link, or
 * an admin phones them.
 */
export class LandlordReferenceDto {
  @ApiProperty({ example: 'Mrs Dlamini' })
  @IsString() @MinLength(2) @MaxLength(120)
  refereeName!: string;

  @ApiProperty({
    example: '082 123 4567',
    description: 'South African mobile number. Normalised server-side.',
  })
  @IsString()
  @Matches(/^(\+?27|0)[6-8][0-9]{8}$/, {
    message: 'Enter a valid South African mobile number, e.g. 082 123 4567',
  })
  refereePhone!: string;

  @ApiPropertyOptional({
    example: 'Back room, Ext 7, Tembisa',
    description:
      'Enough for the referee to recognise which tenancy is being asked about. Deliberately not a full address — we have no need for one.',
  })
  @IsOptional() @IsString() @MaxLength(200)
  propertyDescription?: string;

  @ApiPropertyOptional({ example: '2024-03-01' })
  @IsOptional() @IsISO8601()
  tenancyStartedAt?: string;

  @ApiPropertyOptional({ example: '2025-08-31' })
  @IsOptional() @IsISO8601()
  tenancyEndedAt?: string;
}

export class SubmitVerificationDto {
  @ApiProperty({ enum: TYPES })
  @IsEnum(TYPES as unknown as object)
  type!: VerificationType;

  @ApiPropertyOptional({
    description:
      'Private ImageKit path. Upload with isPrivateFile:true — these are special personal information under POPIA s.26 and must never be publicly addressable. Omitted for landlord_reference, which is a phone call rather than a file.',
  })
  @IsOptional() @IsString() @MaxLength(500)
  documentPath?: string;

  @ApiPropertyOptional({
    type: LandlordReferenceDto,
    description: 'Required for, and only valid on, type landlord_reference.',
  })
  @IsOptional() @ValidateNested() @Type(() => LandlordReferenceDto)
  reference?: LandlordReferenceDto;
}
