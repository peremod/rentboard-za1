import { IsString, IsEnum, IsInt, Min, IsOptional, IsBoolean, IsDateString, MaxLength, MinLength, IsIn, IsArray, ArrayMaxSize, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SA_PROVINCES } from './room-filters.dto';

/**
 * Free-tier photo cap: 1 cover (heroImagePath) + 19 gallery photos
 * (imagePaths) = 20 total. Mirrors the frontend's PhotoUpload cap and
 * RoomsService.assertPhotoLimit() — three independent enforcement points
 * for the same stated limit, not just a UI-level suggestion.
 */
const MAX_GALLERY_PHOTOS = 19;

/**
 * What the household is like, for a shared house — Phase 6.
 *
 * Sent with the LISTING and stored on the Property, which is where household
 * facts live (four rooms at one address have one household; asked four times,
 * the four answers disagree in front of the person choosing). The listing flow
 * is simply the only place that asks for them, because a sub-lessor has no yard
 * screen and should not be made to create one.
 *
 * Every field is optional and every enum has an `unstated` value that is never
 * rendered. Saying nothing has to stay possible: a default would put a claim
 * about the people somebody would live with in front of them that nobody made.
 */
export class HouseholdDto {
  @ApiPropertyOptional({ enum: ['professionals', 'students', 'mixed', 'couples', 'unstated'] })
  @IsOptional() @IsEnum(['professionals', 'students', 'mixed', 'couples', 'unstated'])
  housemateProfile?: 'professionals' | 'students' | 'mixed' | 'couples' | 'unstated';

  @ApiPropertyOptional({ enum: ['weekday_working', 'shift_work', 'mostly_home', 'varied', 'unstated'] })
  @IsOptional() @IsEnum(['weekday_working', 'shift_work', 'mostly_home', 'varied', 'unstated'])
  householdSchedule?: 'weekday_working' | 'shift_work' | 'mostly_home' | 'varied' | 'unstated';

  @ApiPropertyOptional({ enum: ['very_tidy', 'tidy_enough', 'relaxed', 'unstated'] })
  @IsOptional() @IsEnum(['very_tidy', 'tidy_enough', 'relaxed', 'unstated'])
  householdCleanliness?: 'very_tidy' | 'tidy_enough' | 'relaxed' | 'unstated';

  @ApiPropertyOptional({ enum: ['social', 'quiet', 'balanced', 'unstated'] })
  @IsOptional() @IsEnum(['social', 'quiet', 'balanced', 'unstated'])
  householdSocial?: 'social' | 'quiet' | 'balanced' | 'unstated';

  @ApiPropertyOptional({ description: 'How many people already live at the address.' })
  @IsOptional() @IsInt() @Min(0)
  currentHousemates?: number;

  @ApiPropertyOptional({
    description: 'House rules in your own words — the specific ones that matter here, not a checklist.',
  })
  @IsOptional() @IsString() @MaxLength(1000)
  houseRules?: string;
}

export class CreateRoomDto {
  @ApiProperty({ enum: ['shared_house', 'en_suite', 'studio', 'private'] })
  @IsEnum(['shared_house', 'en_suite', 'studio', 'private'])
  roomType!: 'shared_house' | 'en_suite' | 'studio' | 'private';

  @ApiProperty({ example: 'Spacious en-suite in Sandton professional house' })
  @IsString() @MinLength(10) @MaxLength(80)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @ApiProperty({ description: 'Monthly rent in ZAR cents, e.g. R5500 = 550000', example: 550000 })
  @IsInt() @Min(10000, { message: 'Rent must be at least R100/month' })
  rentCents!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) depositCents?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() billsIncluded?: boolean;

  @ApiProperty({ enum: SA_PROVINCES }) @IsIn(SA_PROVINCES) province!: string;
  @ApiProperty({ example: 'Sandton' }) @IsString() city!: string;
  @ApiProperty({ example: 'Sandton, Gauteng' }) @IsString() locationDisplay!: string;

  @ApiProperty() @IsDateString() availableFrom!: string;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) housematesCount?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() couplesAllowed?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() dssAccepted?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() guarantorAccepted?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() petsAllowed?: boolean;

  @ApiPropertyOptional({
    description: 'Amenity keys from the shared AMENITIES list.',
    example: ['shower_indoor', 'prepaid_electricity', 'furnished'],
  })
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(40)
  amenities?: string[];

  @ApiPropertyOptional({ description: 'ImageKit path — the room cover photo' })
  @IsOptional() @IsString() @MaxLength(500)
  heroImagePath?: string;

  @ApiPropertyOptional({ description: `Gallery photo paths, max ${MAX_GALLERY_PHOTOS} (20 total with the cover)`, type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_GALLERY_PHOTOS) @IsString({ each: true })
  imagePaths?: string[];

  /**
   * Owner-let or sublet — Phase 6.
   *
   * ⚠️ Accepted from the client but NOT trusted: a `TENANT` account may only
   * hold a `sublessor` listing, and RoomsService.create overrides this rather
   * than refusing it. Refusing would mean a confusing error for a client that
   * simply forgot the field; overriding means the only person who can create an
   * owner listing is someone whose account says they are one.
   */
  @ApiPropertyOptional({
    enum: ['owner_landlord', 'sublessor'],
    description: 'Defaults to owner_landlord. A tenant account is always sublessor.',
  })
  @IsOptional() @IsEnum(['owner_landlord', 'sublessor'])
  listerType?: 'owner_landlord' | 'sublessor';

  @ApiPropertyOptional({ type: HouseholdDto, description: 'What the household is like. Stored on the property.' })
  @IsOptional() @ValidateNested() @Type(() => HouseholdDto)
  household?: HouseholdDto;

  /**
   * Group this room under one of the lister's own properties — Phase 7b.
   *
   * Set by the wizard's property picker, and by "+ Add a room to this property"
   * on the property detail screen. Validated against the caller's own
   * properties in RoomsService.create: a property id that is not theirs is a
   * refusal, not a silent ignore, because a landlord told "saved" while their
   * room went somewhere else would have no way to notice.
   */
  @ApiPropertyOptional({ description: "One of your own properties, to group this room under." })
  @IsOptional() @IsUUID()
  propertyId?: string;
}
