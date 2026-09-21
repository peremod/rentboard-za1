import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RentStatus } from '@prisma/client';

const STATUSES: RentStatus[] = ['unpaid', 'paid', 'partial', 'waived'];

export class MarkRentDto {
  @ApiProperty({
    example: '2026-09-01',
    description: 'Any date inside the month. Normalised server-side to the first, at midnight UTC.',
  })
  @IsISO8601()
  periodStart!: string;

  @ApiProperty({ enum: STATUSES })
  @IsEnum(STATUSES as unknown as object)
  status!: RentStatus;
}

export class DisputeRentDto {
  @ApiPropertyOptional({
    maxLength: 300,
    description:
      "The tenant's own account — 'paid on the 3rd by EFT'. Optional, because being able to disagree matters more than being able to explain.",
  })
  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class RentSettingsDto {
  @ApiProperty({
    minimum: 0, maximum: 28,
    description:
      'Days after the 1st before an unpaid month triggers a reminder. 0 turns reminders off without turning off the tracking.',
  })
  @IsInt() @Min(0) @Max(28)
  rentGraceDays!: number;
}
