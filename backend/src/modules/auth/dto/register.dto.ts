import { IsEmail, IsString, MinLength, MaxLength, IsEnum, Matches, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * RegisterDto — validated by the global ValidationPipe (whitelist + forbidNonWhitelisted).
 * Password must contain 1 uppercase, 1 lowercase, 1 number, min 8 chars.
 */
export class RegisterDto {
  @ApiProperty({ example: 'sarah@example.co.za' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'MySecureP@ss123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password!: string;

  @ApiProperty({ example: 'Sarah Mokoena' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ enum: ['TENANT', 'LANDLORD'] })
  @IsEnum(['TENANT', 'LANDLORD'], { message: 'Role must be either TENANT or LANDLORD' })
  role!: 'TENANT' | 'LANDLORD';

  @ApiPropertyOptional({ description: 'Optional referral or launch invite code.' })
  @IsOptional() @IsString() @MaxLength(32)
  referralCode?: string;
}
