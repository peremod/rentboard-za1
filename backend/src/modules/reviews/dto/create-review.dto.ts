import { IsEnum, IsInt, IsString, IsUUID, Min, Max, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty() @IsUUID()
  tenancyId!: string;

  @ApiProperty({
    enum: ['room', 'landlord', 'tenant'],
    description: 'A tenant writes room and landlord reviews; a landlord writes the tenant review.',
  })
  @IsEnum(['room', 'landlord', 'tenant'])
  type!: 'room' | 'landlord' | 'tenant';

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1, { message: 'Rating must be between 1 and 5' }) @Max(5, { message: 'Rating must be between 1 and 5' })
  rating!: number;

  @ApiProperty({ minLength: 20, maxLength: 2000 })
  @IsString()
  @MinLength(20, { message: 'Please write at least a sentence — a rating with no explanation helps nobody.' })
  @MaxLength(2000)
  comment!: string;
}
