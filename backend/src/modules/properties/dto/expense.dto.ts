import {
  IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '@prisma/client';

const CATEGORIES: ExpenseCategory[] = ['municipal', 'water', 'electricity', 'maintenance', 'other'];

export class CreateExpenseDto {
  @ApiProperty({ description: 'The yard this was spent on.' })
  @IsUUID('4')
  propertyId!: string;

  @ApiPropertyOptional({
    description:
      'Set only when the cost belongs to one room rather than the whole address — a geyser in room 3. Most expenses are the address.',
  })
  @IsOptional() @IsUUID('4')
  roomId?: string;

  @ApiProperty({ enum: CATEGORIES })
  @IsEnum(CATEGORIES)
  category!: ExpenseCategory;

  /**
   * Cents, like every other amount here.
   *
   * Min 1: a zero-rand expense is a typo, not a record, and allowing it puts
   * rows in the monthly total that move nothing and look like data loss.
   * Max is R10 000 000, high enough for a roof and low enough that a slipped
   * decimal is caught rather than quietly making a year's figures nonsense.
   */
  @ApiProperty({ example: 45000, description: 'ZAR cents. R450 is 45000.' })
  @IsInt() @Min(1) @Max(1_000_000_000)
  amountCents!: number;

  /**
   * The day the money went out, not the day it was typed.
   *
   * A landlord catching up on a month of receipts on one evening would
   * otherwise file all of them under that evening, and every monthly total
   * either side would be wrong.
   */
  @ApiProperty({ example: '2026-09-14' })
  @IsISO8601()
  incurredOn!: string;

  @ApiPropertyOptional({ description: 'ImageKit path, uploaded from the browser like every other image here.' })
  @IsOptional() @IsString() @MaxLength(500)
  receiptPath?: string;

  @ApiPropertyOptional({ example: 'Plumber for the geyser in room 3' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

/**
 * Every field optional, and the property can move.
 *
 * A landlord who filed the municipal bill against the wrong yard needs to fix
 * it, not delete and retype it — and deleting is the thing they will do
 * instead if editing cannot move it, which loses the receipt.
 */
export class UpdateExpenseDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Send null to clear it — see the service.' })
  @IsOptional() @IsUUID('4')
  roomId?: string | null;

  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsEnum(CATEGORIES)
  category?: ExpenseCategory;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000)
  amountCents?: number;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  incurredOn?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  receiptPath?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}
