/** A badge the platform awarded from usage data — never self-declared. */
export interface Badge {
  id: 'since' | 'verified' | 'tenants_placed' | 'replies_fast' | 'multi_room';
  label: string;
  /** Why they have it. A badge nobody can explain is a gimmick. */
  basis: string;
}

/** A room as the storefront lists it — enough for a card, not the full record. */
export interface StorefrontRoom {
  id: string;
  title: string;
  rentCents: number;
  locationDisplay: string;
  heroImagePath?: string | null;
  publishedAt?: string | null;
}

/**
 * A landlord's public page.
 *
 * Every figure here is absent rather than flattering when there is too little
 * behind it: `typicalResponseHours` is null below three answered applications,
 * because on a page a tenant uses to decide whether to bother applying, one fast
 * reply must not become a habit.
 */
export interface PublicStorefront {
  slug: string;
  /** Business name if they gave one, otherwise their own name. */
  displayName: string;
  bio?: string | null;
  logoPath?: string | null;
  verified: boolean;
  rating?: number | null;
  ratingCount: number;
  memberSince: string;
  monthsActive: number;
  roomsAvailable: number;
  tenantsPlaced: number;
  /** Median hours to a first response, or null with too little behind it. */
  typicalResponseHours: number | null;
  /** How many answered applications that is from. Shown, not hidden. */
  responseFrom: number;
  rooms: StorefrontRoom[];
  badges: Badge[];
}

/** What the landlord themselves can see and change. */
export interface MyStorefront {
  slug: string | null;
  bio?: string | null;
  logoPath?: string | null;
  storefrontLive: boolean;
  companyName?: string | null;
  idVerified: boolean;
}
