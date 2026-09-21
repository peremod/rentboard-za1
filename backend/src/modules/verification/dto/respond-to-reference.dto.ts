import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A previous landlord's answer.
 *
 * Two questions, deliberately. A referee who has been messaged out of the
 * blue will answer two and abandon six, and the second question — a rating —
 * only makes sense if the first was yes.
 */
export class RespondToReferenceDto {
  @ApiProperty({
    enum: ['confirm', 'decline'],
    description:
      '`decline` is a real answer, not a non-answer: a referee who will not vouch for someone needs a way to say so.',
  })
  @IsEnum(['confirm', 'decline'])
  outcome!: 'confirm' | 'decline';

  @ApiPropertyOptional({
    minimum: 1, maximum: 5,
    description: 'How the tenancy went, 1–5. Required when confirming.',
  })
  @ValidateIf((dto: RespondToReferenceDto) => dto.outcome === 'confirm')
  @IsInt() @Min(1) @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: "The referee's own words. Sanitised on the way in." })
  @IsOptional() @IsString() @MaxLength(500)
  comment?: string;
}
