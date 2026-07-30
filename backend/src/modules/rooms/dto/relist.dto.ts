import { IsOptional, IsInt, Min, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** One-click relist can optionally bump the price or push the availability date. */
export class RelistDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(10000) rentCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() availableFrom?: string;
}
