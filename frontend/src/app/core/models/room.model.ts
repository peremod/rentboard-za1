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
