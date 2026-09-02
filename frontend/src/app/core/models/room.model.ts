export type RoomType = 'shared_house' | 'en_suite' | 'studio' | 'private';
export type RoomStatus = 'draft' | 'active' | 'reserved' | 'let' | 'paused' | 'deleted';

export const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
] as const;
export type SAProvince = (typeof SA_PROVINCES)[number];

/** Public landlord summary attached to a room by the rooms API. */
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

  isFeatured: boolean;
  featuredUntil?: string | null;
  viewCount: number;
  applicationCount: number;
  relistCount: number;
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
  billsIncluded?: boolean;
  couplesAllowed?: boolean;
  dssAccepted?: boolean;
  guarantorAccepted?: boolean;
  petsAllowed?: boolean;
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
