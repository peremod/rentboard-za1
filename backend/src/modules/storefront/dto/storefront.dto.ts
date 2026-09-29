import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStorefrontDto {
  /**
   * The landlord's own words. 600 characters: long enough to say who you are and
   * how you run your rooms, short enough that it stays a paragraph rather than
   * becoming an unmoderated page of text on an indexable URL.
   */
  @ApiPropertyOptional({ maxLength: 600 })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string;

  @ApiPropertyOptional({ description: 'ImageKit path for a logo or photo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoPath?: string;

  @ApiPropertyOptional({ description: 'Publish or unpublish the public page' })
  @IsOptional()
  @IsBoolean()
  storefrontLive?: boolean;
}
