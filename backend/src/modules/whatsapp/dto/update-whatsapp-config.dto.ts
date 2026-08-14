import { IsString, IsBoolean, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWhatsappConfigDto {
  @ApiProperty({ example: '+27821234567', description: 'E.164 format' })
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'Phone number must be in E.164 format, e.g. +27821234567' })
  phoneNumber!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  waEnabled?: boolean;
}
