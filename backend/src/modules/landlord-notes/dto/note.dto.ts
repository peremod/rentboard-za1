import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class WriteNoteDto {
  /**
   * 2000 characters. Long enough for a real recollection of a tenancy, short
   * enough that it stays a note rather than becoming a file on a person.
   */
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
