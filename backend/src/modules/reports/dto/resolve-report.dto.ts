import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveReportDto {
  @ApiProperty({ enum: ['investigating', 'actioned', 'dismissed'] })
  @IsEnum(['investigating', 'actioned', 'dismissed'])
  status!: 'investigating' | 'actioned' | 'dismissed';

  @ApiPropertyOptional({ description: 'What was done and why. Admin-only.' })
  @IsOptional() @IsString() @MaxLength(1000)
  resolutionNote?: string;
}
