import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewVerificationDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Required when rejecting — shown to the landlord.' })
  @IsOptional() @IsString() @MaxLength(500)
  reviewNote?: string;
}
