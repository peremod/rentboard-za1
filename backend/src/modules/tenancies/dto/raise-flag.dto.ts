import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TenancyFlagReason } from '@prisma/client';

const REASONS: TenancyFlagReason[] = [
  'unpaid_rent', 'property_damage', 'left_without_notice',
  'deposit_withheld', 'room_not_as_described', 'unlawful_entry_or_eviction',
  'harassment', 'other',
];

export class RaiseFlagDto {
  @ApiProperty({ enum: REASONS })
  @IsEnum(REASONS as unknown as object)
  reason!: TenancyFlagReason;

  @ApiProperty({
    minLength: 20, maxLength: 2000,
    description:
      'What happened, in your own words. Required, and with a floor: a reason code alone gives an admin nothing to act on, and a flag that cannot be acted on is a mark against someone that nobody will ever lift.',
  })
  @IsString() @MinLength(20) @MaxLength(2000)
  detail!: string;
}
