import { IsEnum, IsOptional, IsString, IsUUID, IsEmail, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const REPORT_REASONS = [
  'not_a_real_listing',
  'agent_posing_as_landlord',
  'upfront_payment_demanded',
  'discriminatory',
  'misleading_details',
  'harassment',
  'already_let',
  'other',
] as const;

export class CreateReportDto {
  @ApiPropertyOptional({ description: 'The listing being reported' })
  @IsOptional() @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'The account being reported, if not tied to one listing' })
  @IsOptional() @IsUUID()
  reportedUserId?: string;

  @ApiProperty({ enum: REPORT_REASONS })
  @IsEnum(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @ApiProperty({ description: 'What happened. Specifics help — amounts, dates, what was said.' })
  @IsString()
  @MinLength(20, { message: 'Please give a little more detail so we can investigate.' })
  @MaxLength(2000)
  details!: string;

  @ApiPropertyOptional({ description: 'Required when reporting without an account' })
  @IsOptional() @IsEmail() @MaxLength(255)
  contactEmail?: string;
}
