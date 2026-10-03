import {
  Equals, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PhoneCodeDto {
  @ApiProperty({ example: '0821234567', description: 'South African mobile, any common format' })
  @IsString()
  @Matches(/^(\+?27|0)[6-8]\d{8}$/, {
    message: 'Enter a valid South African mobile number, e.g. 082 123 4567',
  })
  phone!: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '0821234567' })
  @IsString()
  @Matches(/^(\+?27|0)[6-8]\d{8}$/, { message: 'Enter a valid South African mobile number' })
  phone!: string;

  @ApiProperty({ example: '482913' })
  @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  code!: string;
}

/** Confirming a number already on the account — no phone field needed. */
export class ConfirmNumberDto {
  @ApiProperty({ example: '482913' })
  @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  code!: string;
}

/**
 * Finishing a phone sign-up — Phase 7g part two.
 *
 * `acceptTerms` is `@Equals(true)`, not `@IsBoolean()`: false has to be a
 * validation failure with a message about the Terms, not a request that reaches
 * the service and creates an account with `consentAcceptedAt` quietly null.
 */
export class CompletePhoneSignupDto {
  @ApiProperty({ description: 'The ticket returned by /auth/phone/signup/verify' })
  @IsString() @Length(20, 200)
  ticket!: string;

  @ApiProperty({ example: 'Sipho Ndlovu' })
  @IsString() @MinLength(2) @MaxLength(100)
  fullName!: string;

  @ApiProperty({ enum: ['TENANT', 'LANDLORD'] })
  @IsEnum(['TENANT', 'LANDLORD'], { message: 'Role must be either TENANT or LANDLORD' })
  role!: 'TENANT' | 'LANDLORD';

  @ApiProperty({
    description:
      'The person\'s own acceptance of the Terms, Privacy Policy and POPIA processing. ' +
      'Must be true — there is no path to an account without it.',
  })
  @Equals(true, { message: 'Please accept the Terms and Privacy Policy to create your account.' })
  acceptTerms!: boolean;

  @ApiPropertyOptional({ description: 'Optional referral or launch invite code.' })
  @IsOptional() @IsString() @MaxLength(32)
  referralCode?: string;
}
