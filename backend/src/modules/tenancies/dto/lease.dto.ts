import { IsEnum, IsISO8601, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLeaseTermsDto {
  @ApiPropertyOptional({ example: '2026-03-01', description: 'Agreed move-in.' })
  @IsOptional() @IsISO8601()
  startDate?: string | null;

  /**
   * Null is a real value: it says month-to-month.
   *
   * Distinguished from "not sent", because converting a fixed term into a
   * rolling one is what happens when a lease runs out and both sides carry on,
   * and that has to be expressible.
   */
  @ApiPropertyOptional({
    example: '2027-02-28',
    description: 'End of the fixed term. Send null for month-to-month.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  leaseEndDate?: string | null;

  /**
   * What the LEASE says, not what the law says.
   *
   * Capped at 365 and floored at 0. 0 is allowed deliberately: some
   * arrangements in this market genuinely have no notice period, and refusing
   * to record that would make a landlord enter a number that is not true.
   */
  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional() @IsInt() @Min(0) @Max(365)
  noticePeriodDays?: number;
}

export class GiveNoticeDto {
  /**
   * Who gave notice. Recorded rather than assumed, because "the tenant told me
   * they are leaving" and "I gave the tenant notice" are different facts and a
   * dispute later turns on which happened.
   */
  @ApiPropertyOptional({ enum: ['tenant', 'landlord'], default: 'tenant' })
  @IsOptional() @IsEnum(['tenant', 'landlord'])
  givenBy: 'tenant' | 'landlord' = 'tenant';

  /** Backdated when notice was given verbally days earlier, as it usually is. */
  @ApiPropertyOptional({ example: '2026-09-20' })
  @IsOptional() @IsISO8601()
  givenOn?: string;
}
