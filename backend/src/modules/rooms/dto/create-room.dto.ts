import { IsString, IsEnum, IsInt, Min, IsOptional, IsBoolean, IsDateString, MaxLength, MinLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SA_PROVINCES } from './room-filters.dto';

export class CreateRoomDto {
  @ApiProperty({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType!: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiProperty({ example: 'Spacious en-suite in Sandton professional house' })
  @IsString() @MinLength(10) @MaxLength(80)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @ApiProperty({ description: 'Monthly rent in ZAR cents, e.g. R5500 = 550000', example: 550000 })
  @IsInt() @Min(10000, { message: 'Rent must be at least R100/month' })
  rentCents!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) depositCents?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() billsIncluded?: boolean;

  @ApiProperty({ enum: SA_PROVINCES }) @IsIn(SA_PROVINCES) province!: string;
  @ApiProperty({ example: 'Sandton' }) @IsString() city!: string;
  @ApiProperty({ example: 'Sandton, Gauteng' }) @IsString() locationDisplay!: string;

  @ApiProperty() @IsDateString() availableFrom!: string;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) housematesCount?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() couplesAllowed?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() dssAccepted?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() guarantorAccepted?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() petsAllowed?: boolean;
}
