import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondToReviewDto {
  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @IsString() @MinLength(10) @MaxLength(1000)
  response!: string;
}
