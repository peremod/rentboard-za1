import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'sarah@example.co.za' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password!: string;
}
