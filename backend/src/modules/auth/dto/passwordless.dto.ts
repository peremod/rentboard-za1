import { IsEmail, IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MagicLinkDto {
  @ApiProperty({ example: 'sarah@example.co.za' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email!: string;

  @ApiPropertyOptional({
    enum: ['TENANT', 'LANDLORD'],
    description: 'Only used to point someone at the right signup if they have no account.',
  })
  @IsOptional() @IsEnum(['TENANT', 'LANDLORD'])
  role?: 'TENANT' | 'LANDLORD';
}

export class VerifyMagicLinkDto {
  @ApiProperty()
  @IsString() @MaxLength(200)
  token!: string;
}
