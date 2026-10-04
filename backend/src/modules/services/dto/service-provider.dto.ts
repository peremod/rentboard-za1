import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsOptional, IsString,
  MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceCategory } from '@prisma/client';

const CATEGORIES: ServiceCategory[] = ['plumber', 'electrician', 'locksmith', 'cleaner', 'other'];

export class CreateServiceProviderDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsEnum(CATEGORIES)
  category!: ServiceCategory;

  @ApiProperty({ example: 'Sipho — Tembisa Plumbing' })
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  /**
   * Accepted in whatever form the admin has it, normalised on the way in.
   *
   * 082 123 4567 and +27821234567 are one tradesperson, and a directory that
   * lists them twice is one nobody trusts. The service rejects anything that is
   * not a South African mobile rather than storing it unusable — a `tel:` link
   * built from a number that is not a number is a dead end in front of a
   * landlord with a burst pipe.
   */
  @ApiProperty({ example: '082 123 4567', description: 'Any SA mobile format; stored as +27…' })
  @IsString() @MinLength(9) @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ default: true, description: 'Whether this number is on WhatsApp.' })
  @IsOptional() @IsBoolean()
  whatsapp?: boolean;

  @ApiProperty({ type: [String], example: ['Tembisa', 'Kempton Park'] })
  @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(80, { each: true })
  areas!: string[];

  @ApiPropertyOptional({ example: 'Does geysers and blocked drains. Cash or EFT.' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ default: false, description: 'Off by default — see the schema note.' })
  @IsOptional() @IsBoolean()
  active?: boolean;

  /** Present for the future paid-placement line. Nothing reads it yet. */
  @ApiPropertyOptional()
  @IsOptional() @IsISO8601()
  sponsoredUntil?: string | null;

  // ── What was checked — Phase 7j ─────────────────────────────────────────
  //
  // ⚠️ Dates, not booleans. A check has a date or it is a rumour: "we verified
  // them" with no date is worth nothing two years later, and a landlord
  // deciding today should be able to see that the reference call was in 2024.
  //
  // Supplied by the admin rather than stamped by the server, because the check
  // happened when it happened — a phone call on Tuesday recorded on Thursday is
  // a Tuesday check, and back-dating it is the honest option.

  /**
   * We rang this number and reached this person.
   *
   * The minimum bar for being listed: `active` cannot be true without it,
   * enforced in the service AND as a CHECK constraint.
   */
  @ApiPropertyOptional({ description: 'When we rang the number and reached them. Required to list.' })
  @IsOptional() @IsISO8601()
  phoneConfirmedAt?: string | null;

  /**
   * We were shown an identity document.
   *
   * ⚠️ Only the OUTCOME is stored. The document is never uploaded, never
   * stored and never referenced — the rule verification_requests already
   * follows (POPIA s.19, minimality). There is deliberately no documentPath
   * here, and adding one would be a change to argue about rather than a field
   * to fill in.
   */
  @ApiPropertyOptional({ description: 'When an identity document was seen. The document is never stored.' })
  @IsOptional() @IsISO8601()
  idCheckedAt?: string | null;

  /** We spoke to a landlord this person has worked for. */
  @ApiPropertyOptional({ description: 'When we spoke to a landlord they have worked for.' })
  @IsOptional() @IsISO8601()
  referenceCheckedAt?: string | null;

  /**
   * A trade registration, as the issuing body writes it.
   *
   * "PIRB P12345" for a plumber, a Department of Labour number for an
   * electrician who can issue a Certificate of Compliance. Free text because
   * the bodies differ per trade and several trades have none — an enum would
   * force an admin to lie or leave it blank. Shown to landlords verbatim so
   * they can check it with the body themselves, which is the only thing that
   * makes it worth storing.
   */
  @ApiPropertyOptional({ example: 'PIRB P12345' })
  @IsOptional() @IsString() @MaxLength(80)
  tradeRegistration?: string | null;
}

export class UpdateServiceProviderDto {
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsEnum(CATEGORIES)
  category?: ServiceCategory;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(9) @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  whatsapp?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(80, { each: true })
  areas?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  sponsoredUntil?: string | null;

  // ── What was checked — Phase 7j ─────────────────────────────────────────
  //
  // ⚠️ Dates, not booleans. A check has a date or it is a rumour: "we verified
  // them" with no date is worth nothing two years later, and a landlord
  // deciding today should be able to see that the reference call was in 2024.
  //
  // Supplied by the admin rather than stamped by the server, because the check
  // happened when it happened — a phone call on Tuesday recorded on Thursday is
  // a Tuesday check, and back-dating it is the honest option.

  /**
   * We rang this number and reached this person.
   *
   * The minimum bar for being listed: `active` cannot be true without it,
   * enforced in the service AND as a CHECK constraint.
   */
  @ApiPropertyOptional({ description: 'When we rang the number and reached them. Required to list.' })
  @IsOptional() @IsISO8601()
  phoneConfirmedAt?: string | null;

  /**
   * We were shown an identity document.
   *
   * ⚠️ Only the OUTCOME is stored. The document is never uploaded, never
   * stored and never referenced — the rule verification_requests already
   * follows (POPIA s.19, minimality). There is deliberately no documentPath
   * here, and adding one would be a change to argue about rather than a field
   * to fill in.
   */
  @ApiPropertyOptional({ description: 'When an identity document was seen. The document is never stored.' })
  @IsOptional() @IsISO8601()
  idCheckedAt?: string | null;

  /** We spoke to a landlord this person has worked for. */
  @ApiPropertyOptional({ description: 'When we spoke to a landlord they have worked for.' })
  @IsOptional() @IsISO8601()
  referenceCheckedAt?: string | null;

  /**
   * A trade registration, as the issuing body writes it.
   *
   * "PIRB P12345" for a plumber, a Department of Labour number for an
   * electrician who can issue a Certificate of Compliance. Free text because
   * the bodies differ per trade and several trades have none — an enum would
   * force an admin to lie or leave it blank. Shown to landlords verbatim so
   * they can check it with the body themselves, which is the only thing that
   * makes it worth storing.
   */
  @ApiPropertyOptional({ example: 'PIRB P12345' })
  @IsOptional() @IsString() @MaxLength(80)
  tradeRegistration?: string | null;
}
