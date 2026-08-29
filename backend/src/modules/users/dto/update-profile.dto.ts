import { IsOptional, IsString, IsBoolean, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Marketing email consent (room alerts and digests). Transactional mail about your applications is unaffected.',
  })
  @IsOptional() @IsBoolean()
  marketingEmails?: boolean;

  @ApiPropertyOptional({ example: 'Sarah Mokoena' })
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({
    example: '0821234567',
    description: 'South African number. Send an empty string to clear it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^(\+27|0)[6-8][0-9]{8}$|^$/, {
    message: 'Enter a valid South African mobile number, e.g. 082 123 4567',
  })
  phone?: string;
}
