import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewFlagDto {
  @ApiProperty({ enum: ['upheld', 'dismissed'] })
  @IsEnum(['upheld', 'dismissed'])
  status!: 'upheld' | 'dismissed';

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Shown to both parties. A decision that arrives as silence is not a decision.',
  })
  @IsOptional() @IsString() @MaxLength(1000)
  reviewNote?: string;
}
