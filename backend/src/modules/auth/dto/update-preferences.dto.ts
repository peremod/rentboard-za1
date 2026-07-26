import { IsOptional, IsString } from 'class-validator';

/** Non-language user preference fields land here as they're added (theme, notifications, etc). */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  phone?: string;
}
