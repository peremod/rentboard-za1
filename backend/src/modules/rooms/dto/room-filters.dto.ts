import { IsOptional, IsString, IsEnum, IsBoolean, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
] as const;

/** Query params for GET /rooms — public notice-board search. */
export class RoomFiltersDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsOptional() @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType?: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiPropertyOptional({ enum: SA_PROVINCES })
  @IsOptional() @IsIn(SA_PROVINCES)
  province?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;

  @ApiPropertyOptional({ description: 'Max monthly rent in ZAR cents' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxRentCents?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) minRentCents?: number;

  /**
   * Rooms someone can move into now.
   *
   * Defined as available within the next 14 days rather than strictly today.
   * A room free on the 1st is 'immediate' to someone searching on the 25th,
   * and a same-day-only filter would return almost nothing on most days —
   * which teaches people the filter is broken rather than that the board is
   * empty.
   */
  @ApiPropertyOptional({ description: 'Only rooms available within the next 14 days' })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  availableNow?: boolean;

  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() billsIncluded?: boolean;

  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() couplesAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() dssAccepted?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() guarantorAccepted?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() petsAllowed?: boolean;

  // ── Sub-letting and household compatibility — Phase 6 ──────────────────
  //
  // Positioning decision (2026-10-03): sublet listings share the SAME board as
  // backroom rentals, with an explicit filter, rather than sitting in a separate
  // category. Splitting the board halves the inventory each half can show, and
  // at launch volumes a thin board is the thing that loses both segments. The
  // filter is how somebody who only wants one kind says so.

  @ApiPropertyOptional({
    enum: ['owner_landlord', 'sublessor'],
    description: 'owner_landlord for rooms let by the owner; sublessor for a tenant subletting.',
  })
  @IsOptional() @IsEnum(['owner_landlord', 'sublessor'])
  listerType?: 'owner_landlord' | 'sublessor';

  /**
   * ⚠️ Every household filter below EXCLUDES listings that have not said.
   *
   * That is unavoidable — a room whose household is `unstated` cannot be
   * matched or ruled out — but it means any of these can take a board of two
   * hundred rooms down to five while looking like an ordinary narrowing. The
   * UI says so beside the controls; an API caller gets this comment.
   */
  @ApiPropertyOptional({ enum: ['professionals', 'students', 'mixed', 'couples'] })
  @IsOptional() @IsEnum(['professionals', 'students', 'mixed', 'couples'])
  housemateProfile?: 'professionals' | 'students' | 'mixed' | 'couples';

  @ApiPropertyOptional({ enum: ['weekday_working', 'shift_work', 'mostly_home', 'varied'] })
  @IsOptional() @IsEnum(['weekday_working', 'shift_work', 'mostly_home', 'varied'])
  householdSchedule?: 'weekday_working' | 'shift_work' | 'mostly_home' | 'varied';

  @ApiPropertyOptional({ enum: ['very_tidy', 'tidy_enough', 'relaxed'] })
  @IsOptional() @IsEnum(['very_tidy', 'tidy_enough', 'relaxed'])
  householdCleanliness?: 'very_tidy' | 'tidy_enough' | 'relaxed';

  @ApiPropertyOptional({ enum: ['social', 'quiet', 'balanced'] })
  @IsOptional() @IsEnum(['social', 'quiet', 'balanced'])
  householdSocial?: 'social' | 'quiet' | 'balanced';

  @ApiPropertyOptional({ enum: ['newest', 'price_asc', 'price_desc', 'featured'] })
  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc', 'featured'])
  sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'featured';

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 12 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 12;
}
