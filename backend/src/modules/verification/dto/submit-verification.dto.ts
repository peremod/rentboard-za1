import { IsEnum, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitVerificationDto {
  @ApiProperty({ enum: ['identity', 'proof_of_address', 'proof_of_ownership'] })
  @IsEnum(['identity', 'proof_of_address', 'proof_of_ownership'])
  type!: 'identity' | 'proof_of_address' | 'proof_of_ownership';

  @ApiProperty({
    description: 'Private ImageKit path. Upload with isPrivateFile:true — this is special personal information under POPIA s.26 and must never be publicly addressable.',
  })
  @IsString() @MaxLength(500)
  documentPath!: string;
}
