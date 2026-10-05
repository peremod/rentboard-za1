import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SA_MOBILE = /^(\+?27|0)[6-8]\d{8}$/;

export class OpenRecoveryDto {
  @ApiProperty({ example: '0821234567', description: 'The number the account signs in with now' })
  @IsString() @Matches(SA_MOBILE, { message: 'Enter a valid South African mobile number' })
  phone!: string;

  @ApiProperty({ example: '0829876543', description: 'The number they want it moved to' })
  @IsString() @Matches(SA_MOBILE, { message: 'Enter a valid South African mobile number' })
  newPhone!: string;

  @ApiPropertyOptional({
    description: 'What they told you, in your words. About the request, never about the person.',
  })
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

/**
 * ⚠️ There is deliberately no document upload on this DTO.
 *
 * Only outcomes persist — the same rule as VerificationRequest (POPIA s.19).
 * "Store the ID so we can re-check it later" is a reasonable-sounding thing
 * somebody adds, and a stored identity document is a liability that long
 * outlives its usefulness. What persists is what the admin saw, in words, and
 * when.
 */
export class RecordRecoveryCheckDto {
  @ApiPropertyOptional({
    example: 'Saw a green ID book, name and photo match. Issued 2016.',
    description: 'What identity document you actually saw. Required before approving.',
  })
  @IsOptional() @IsString() @MinLength(5) @MaxLength(1000)
  idSeenNote?: string;

  @ApiPropertyOptional({
    example: 'Named both tenants and the rent on the back room. Correct.',
    description: 'Things only the owner could answer, if you asked any.',
  })
  @IsOptional() @IsString() @MinLength(5) @MaxLength(1000)
  knowledgeCheckedNote?: string;
}

export class RefuseRecoveryDto {
  @ApiProperty({ example: 'Name on the ID does not match the account.' })
  @IsString() @MinLength(5) @MaxLength(500)
  reason!: string;
}

export class ConfirmRecoveryDto {
  @ApiProperty({ example: '0829876543' })
  @IsString() @Matches(SA_MOBILE, { message: 'Enter a valid South African mobile number' })
  phone!: string;

  @ApiProperty({ example: '482913' })
  @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  code!: string;
}
