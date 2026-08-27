import { IsString, IsOptional, IsEnum, IsInt, IsBoolean, Min, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SA_PROVINCES } from '../../rooms/dto/room-filters.dto';

export class SaveSearchDto {
  @ApiProperty({ example: 'En-suite in Sandton under R6000' })
  @IsString() @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ enum: SA_PROVINCES })
  @IsOptional() @IsIn(SA_PROVINCES)
  province?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;

  @ApiPropertyOptional({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsOptional() @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType?: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiPropertyOptional({ description: 'Maximum monthly rent in ZAR cents' })
  @IsOptional() @IsInt() @Min(0) maxRentCents?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minRentCents?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() billsIncluded?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() couplesAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dssAccepted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() guarantorAccepted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() petsAllowed?: boolean;

  @ApiPropertyOptional({ enum: ['instant', 'daily', 'off'], default: 'instant' })
  @IsOptional() @IsEnum(['instant', 'daily', 'off'])
  frequency?: 'instant' | 'daily' | 'off';

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean() notifyEmail?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Requires a verified WhatsApp number on the account' })
  @IsOptional() @IsBoolean() notifyWhatsapp?: boolean;
}
