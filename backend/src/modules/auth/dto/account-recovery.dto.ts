import {
  IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Same policy as registration — a reset must not be a way to set a weak password. */
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter and a number';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'sarah@example.co.za' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the reset email' })
  @IsString() @MaxLength(200)
  token!: string;

  @ApiProperty()
  @IsString() @MinLength(8) @MaxLength(128) @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class ChangePasswordDto {
  /**
   * ⚠️ Optional since Phase 7o, and the reason is not laziness.
   *
   * An account created from a mobile number has no password at all, so there is
   * no current one to type. It used to be told "this account signs in with
   * Google", which was false and was also the only thing between that person
   * and ever having a password. They set a first one with `phoneCode` instead —
   * the handset is the credential they do have.
   *
   * The service decides which is required from the account, not from which
   * field arrived: an account WITH a password still cannot skip it by sending a
   * phone code.
   */
  @ApiPropertyOptional({ description: 'Required when the account has a password.' })
  @IsOptional() @IsString()
  currentPassword?: string;

  @ApiPropertyOptional({
    description: 'A code sent to the verified number. For an account with no password yet.',
  })
  @IsOptional() @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  phoneCode?: string;

  @ApiProperty()
  @IsString() @MinLength(8) @MaxLength(128) @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class RequestEmailChangeDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  newEmail!: string;

  @ApiPropertyOptional({
    description: 'Confirms it is really you — a hijacked session alone is not enough. '
      + 'Required when the account has a password.',
  })
  @IsOptional() @IsString()
  currentPassword?: string;

  @ApiPropertyOptional({
    description: 'A code sent to the verified number, for a phone-only account — Phase 7o. '
      + 'Adding an address is what lets such an account pay the verification fee and be '
      + 'recovered if the number is lost, and it used to be refused with a message about Google.',
  })
  @IsOptional() @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  phoneCode?: string;
}

export class ConfirmEmailChangeDto {
  @ApiProperty()
  @IsString() @MaxLength(200)
  token!: string;
}
