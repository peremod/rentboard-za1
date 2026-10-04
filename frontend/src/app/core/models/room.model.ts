export type RoomType = 'shared_house' | 'en_suite' | 'studio' | 'private';

/**
 * Who is letting the room out — Phase 6.
 *
 * A fact about the LISTING, not about the account: the same person can own a
 * yard and sublet a room in the flat they rent. See the ListerType comment in
 * schema.prisma for the whole of Option A.
 */
export type ListerType = 'owner_landlord' | 'sublessor';

export type HousemateProfile = 'professionals' | 'students' | 'mixed' | 'couples' | 'unstated';
export type HouseholdSchedule = 'weekday_working' | 'shift_work' | 'mostly_home' | 'varied' | 'unstated';
export type HouseholdCleanliness = 'very_tidy' | 'tidy_enough' | 'relaxed' | 'unstated';
export type HouseholdSocial = 'social' | 'quiet' | 'balanced' | 'unstated';
export type RoomStatus = 'draft' | 'active' | 'reserved' | 'let' | 'paused' | 'deleted';

export const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
] as const;
export type SAProvince = (typeof SA_PROVINCES)[number];

/** Public landlord summary attached to a room by the rooms API. */
/**
 * What the rest of the house is like — returned on the room DETAIL only.
 *
 * Deliberately not the yard's name: that is the landlord's own dashboard label
 * and is never published beside a listing.
 */
export interface RoomSharedLiving {
  houseRules?: string | null;
  sharedAmenities?: string[];
  currentHousemates?: number | null;
  housemateProfile?: HousemateProfile;
  /** Phase 6 — compatibility. `unstated` is never rendered. */
  householdSchedule?: HouseholdSchedule;
  householdCleanliness?: HouseholdCleanliness;
  householdSocial?: HouseholdSocial;
}

export interface RoomLandlord {
  id: string;
  fullName: string;
  avatarPath?: string | null;
  landlordProfile?: {
    rating?: number | null;
    ratingCount?: number;
    idVerified?: boolean;
  } | null;
}

export interface Room {
  /** Present only on the detail response, and only when the room is in a yard. */
  property?: RoomSharedLiving | null;
  id: string;
  landlordId: string;
  /** Populated on list and detail responses; absent on landlord-owned queries. */
  landlord?: RoomLandlord | null;
  roomType: RoomType;
  title: string;
  description?: string | null;
  status: RoomStatus;

  /** Monthly rent in ZAR cents — always render via ZarCentsPipe, never divide manually. */
  rentCents: number;
  depositCents?: number | null;
  billsIncluded: boolean;

  province: string;
  city: string;
  locationDisplay: string;

  availableFrom: string;
  housematesCount: number;

  couplesAllowed: boolean;
  dssAccepted: boolean;
  guarantorAccepted: boolean;
  petsAllowed: boolean;
  amenities?: string[];

  heroImagePath?: string | null;
  imagePaths: string[];

  /** Phase 6. Absent on older cached responses, so read it as owner-let. */
  listerType?: ListerType;
  /**
   * When an admin checked THIS sub-lessor's lease and consent to sublet.
   *
   * A date, not a boolean, and the room page says "checked on 14 March" rather
   * than "verified": the head landlord can withdraw consent the next day and
   * nothing tells us. Null means nobody has checked, which is the common case
   * and must read as such rather than as a failure.
   */
  subletCheckedAt?: string | null;

  isFeatured: boolean;
  featuredUntil?: string | null;
  viewCount: number;
  applicationCount: number;
  relistCount: number;
  /**
   * Views in the last seven days, including today — Phase 7d.
   *
   * Present only on the landlord's own room list. `viewCount` beside it is the
   * LIFETIME figure, which is the number the dashboard used to show: a room
   * posted in June could read 200 views without one of them being this month,
   * so it could not answer the only question a landlord with an empty room has.
   * Always a number on that payload, 0 included, so the screen can tell "nobody
   * looked" from "we did not find out".
   */
  viewsLast7Days?: number;
  letAt?: string | null;

  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export interface RoomFilters {
  search?: string;
  roomType?: RoomType;
  province?: string;
  city?: string;
  maxRentCents?: number;
  minRentCents?: number;
  /** Rooms free now or within a fortnight — the urgent search. */
  availableNow?: boolean;
  billsIncluded?: boolean;
  couplesAllowed?: boolean;
  dssAccepted?: boolean;
  guarantorAccepted?: boolean;
  petsAllowed?: boolean;
  /** Phase 6 — who is letting the room out. */
  listerType?: ListerType;
  /**
   * Household compatibility — Phase 6.
   *
   * ⚠️ Each of these excludes every listing whose household is `unstated`,
   * which is most of them. Narrowing, not ranking: there is no "prefer" here,
   * and the board says so beside the controls.
   */
  housemateProfile?: Exclude<HousemateProfile, 'unstated'>;
  householdSchedule?: Exclude<HouseholdSchedule, 'unstated'>;
  householdCleanliness?: Exclude<HouseholdCleanliness, 'unstated'>;
  householdSocial?: Exclude<HouseholdSocial, 'unstated'>;
  sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'featured';
  page?: number;
  limit?: number;
}

export interface PaginatedRooms {
  data: Room[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  /**
   * Landlords who have passed an identity check AND have a room matching this
   * search. Counted on the server across the whole result set, not the page —
   * see the note in rooms.service.ts, where the browser used to compute this
   * from the loaded rooms and got it wrong twice over.
   */
  verifiedLandlords: number;
}

export interface RelistPayload {
  rentCents?: number;
  availableFrom?: string;
}

/**
 * Amenity options for a listing, grouped as a landlord thinks about them.
 *
 * Chosen for what South African tenants actually ask about — prepaid
 * electricity and load-shedding backup matter more here than in most markets,
 * and "shower: indoor or outdoor" is a real distinction in shared houses.
 *
 * The value strings are stored in Room.amenities; changing one orphans
 * existing data, so add rather than rename.
 */
export const AMENITIES: { group: string; items: { value: string; label: string }[] }[] = [
  {
    group: 'Bathroom',
    items: [
      { value: 'shower_indoor', label: 'Indoor shower' },
      { value: 'shower_outdoor', label: 'Outdoor shower' },
      { value: 'bath', label: 'Bath' },
      { value: 'toilet_private', label: 'Private toilet' },
      { value: 'toilet_shared', label: 'Shared toilet' },
    ],
  },
  {
    group: 'Kitchen',
    items: [
      { value: 'kitchen_unit_own', label: 'Own kitchen unit' },
      { value: 'kitchen_shared', label: 'Shared kitchen' },
      { value: 'stove', label: 'Stove' },
      { value: 'fridge', label: 'Fridge' },
      { value: 'microwave', label: 'Microwave' },
    ],
  },
  {
    group: 'Utilities',
    items: [
      { value: 'prepaid_electricity', label: 'Prepaid electricity' },
      { value: 'electricity_included', label: 'Electricity included' },
      { value: 'water_included', label: 'Water included' },
      { value: 'wifi', label: 'WiFi' },
      { value: 'backup_power', label: 'Backup power / inverter' },
      { value: 'geyser', label: 'Hot water geyser' },
    ],
  },
  {
    group: 'The room',
    items: [
      { value: 'furnished', label: 'Furnished' },
      { value: 'built_in_cupboards', label: 'Built-in cupboards' },
      { value: 'tiled_floors', label: 'Tiled floors' },
      { value: 'carpeted', label: 'Carpeted' },
      { value: 'ceiling', label: 'Ceiling' },
      { value: 'burglar_bars', label: 'Burglar bars' },
    ],
  },
  {
    group: 'Property',
    items: [
      { value: 'parking', label: 'Parking' },
      { value: 'secure_complex', label: 'Secure complex' },
      { value: 'garden', label: 'Garden' },
      { value: 'washing_machine', label: 'Washing machine' },
      { value: 'laundry_space', label: 'Space to hang washing' },
    ],
  },
];

/** Flat lookup for rendering a stored value back as a label. */
export const AMENITY_LABELS: Record<string, string> = Object.fromEntries(
  AMENITIES.flatMap((g) => g.items.map((i) => [i.value, i.label])),
);
