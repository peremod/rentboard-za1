import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
  @ApiProperty()
  @IsString()
  currentPassword!: string;

  @ApiProperty()
  @IsString() @MinLength(8) @MaxLength(128) @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class RequestEmailChangeDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  newEmail!: string;

  @ApiProperty({ description: 'Confirms it is really you — a hijacked session alone is not enough' })
  @IsString()
  currentPassword!: string;
}

export class ConfirmEmailChangeDto {
  @ApiProperty()
  @IsString() @MaxLength(200)
  token!: string;
}
