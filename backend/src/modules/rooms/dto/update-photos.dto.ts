import { IsArray, IsString, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Full replacement of a room's gallery. Order matters: [0] is the cover. */
export class UpdatePhotosDto {
  @ApiProperty({
    description: 'ImageKit paths, cover first. Send the complete desired set — this replaces the existing gallery.',
    example: ['rooms/abc/cover.jpg', 'rooms/abc/second.jpg'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20, { message: 'A room can have at most 20 photos.' })
  paths!: string[];
}
