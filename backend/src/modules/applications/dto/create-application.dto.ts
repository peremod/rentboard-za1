import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApplicationDto {
  @ApiProperty() @IsUUID() roomId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) coverNote?: string;
}
