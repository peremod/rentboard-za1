import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum, IsISO8601, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength,
} from 'class-validator';
import { ContractorLeadChannel, ServiceCategory } from '@prisma/client';

const CHANNELS: ContractorLeadChannel[] = ['call', 'whatsapp'];
const CATEGORIES: ServiceCategory[] = ['plumber', 'electrician', 'locksmith', 'cleaner', 'other'];

/** Which button the landlord pressed. */
export class RecordLeadDto {
  @ApiProperty({ enum: CHANNELS })
  @IsEnum(CHANNELS)
  channel!: ContractorLeadChannel;
}

/**
 * What a lead costs for a category, from a date — Phase 7k.
 *
 * ⚠️ There is no default and there is no example amount in the code.
 *
 * The brief said: do not implement arbitrary pricing assumptions, identify where
 * pricing should be configurable. This endpoint is that place. The table ships
 * empty; until somebody inserts a rate, leads are recorded with no fee and
 * marked not billable, which is the honest state of a price nobody has decided.
 *
 * Insert-only: rates are never edited or deleted, because leads point at the
 * one they were created under. Editing would re-price history; deleting would
 * leave a lead claiming a figure from nowhere. A new row supersedes the old.
 */
export class SetLeadRateDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsEnum(CATEGORIES)
  category!: ServiceCategory;

  /**
   * Cents, like every amount in this product — rand is a display concern and
   * the conversion happens at the UI boundary.
   *
   * No example is given deliberately: an example in the docs becomes the number
   * somebody copies, and this one is the owner's to decide.
   */
  @ApiProperty({ description: 'Cents. Positive. No default exists anywhere in the product.' })
  @IsInt() @IsPositive()
  amountCents!: number;

  @ApiProperty({ description: 'From when this rate applies. Rates are effective-dated, never edited.' })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'Why this number, in your words.' })
  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

/**
 * Recording that a contractor agreed to pay for leads.
 *
 * ⚠️ Out of band, because they have no account to agree in. A contractor is not
 * a user — no userId, no email, just a name and a number — so the note an admin
 * writes here is the only evidence the conversation happened. Ten characters for
 * the same reason the closure reason demands them: "yes" is not evidence.
 */
export class LeadFeesAgreedDto {
  @ApiProperty({ example: 'Agreed on the phone, 2 Oct — happy to pay per lead.' })
  @IsString()
  @MinLength(10, {
    message: 'Record how they agreed — it is the only evidence, because they have no account to agree in.',
  })
  @MaxLength(300)
  note!: string;
}
