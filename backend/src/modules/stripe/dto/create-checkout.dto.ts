import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePlanCheckoutDto {
  @ApiProperty({ enum: ['pro', 'agency'] })
  @IsIn(['pro', 'agency'])
  planTier!: 'pro' | 'agency';

  @ApiProperty({ enum: ['monthly', 'annual'] })
  @IsIn(['monthly', 'annual'])
  interval!: 'monthly' | 'annual';
}

export class CreatePassportCheckoutDto {
  @ApiProperty({ enum: ['monthly', 'annual'] })
  @IsIn(['monthly', 'annual'])
  interval!: 'monthly' | 'annual';
}

export class CreateBoostCheckoutDto {
  @ApiProperty() roomId!: string;
}
