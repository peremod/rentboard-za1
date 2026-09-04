import { IsString, Matches, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PhoneCodeDto {
  @ApiProperty({ example: '0821234567', description: 'South African mobile, any common format' })
  @IsString()
  @Matches(/^(\+?27|0)[6-8]\d{8}$/, {
    message: 'Enter a valid South African mobile number, e.g. 082 123 4567',
  })
  phone!: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '0821234567' })
  @IsString()
  @Matches(/^(\+?27|0)[6-8]\d{8}$/, { message: 'Enter a valid South African mobile number' })
  phone!: string;

  @ApiProperty({ example: '482913' })
  @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  code!: string;
}
