import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectApplicationDto {
  @ApiPropertyOptional({ description: 'Optional kind note shown to the tenant' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
