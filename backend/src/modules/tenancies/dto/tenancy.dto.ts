import { IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmStartDto {
  @ApiPropertyOptional({ description: 'Actual move-in date. Defaults to today.' })
  @IsOptional() @IsDateString()
  startDate?: string;
}

export class EndTenancyDto {
  @ApiPropertyOptional({ description: 'Move-out date. Defaults to today.' })
  @IsOptional() @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Visible to the other party.' })
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

export class CancelTenancyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}
