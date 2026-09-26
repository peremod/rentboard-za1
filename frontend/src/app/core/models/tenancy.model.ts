import { Room } from './room.model';

export type TenancyStatus = 'pending' | 'active' | 'ended' | 'cancelled';
export type ReviewType = 'room' | 'landlord' | 'tenant';

export interface TenancyParty {
  id: string;
  fullName: string;
}

export interface Tenancy {
  id: string;
  roomId: string;
  landlordId: string;
  tenantId: string;
  applicationId: string;
  status: TenancyStatus;
  startDate?: string | null;
  endDate?: string | null;
  /** Rent at the time of the letting, snapshotted — not the room's current rent. */
  rentCents: number;
  endedById?: string | null;
  endReason?: string | null;
  reviewsCloseAt?: string | null;
  createdAt: string;

  room?: Pick<Room, 'id' | 'title' | 'locationDisplay' | 'heroImagePath'>;
  landlord?: TenancyParty;
  tenant?: TenancyParty;
  reviews?: { id: string; authorId: string; type: ReviewType; publishedAt?: string | null }[];
}

/** What this user still owes on an ended tenancy, from /tenancies/reviewable. */
export interface ReviewableTenancy {
  tenancy: Tenancy;
  role: 'landlord' | 'tenant';
  outstanding: ReviewType[];
  closesAt: string;
}

/**
 * A post-tenancy dispute report.
 *
 * Deliberately not a review. A review is a public star rating about a room or
 * a person, open for 30 days; this is a private report to the platform that
 * someone behaved badly, which an admin acts on. Conflating them would mean a
 * landlord who kept a deposit is answerable only through a star.
 *
 * Never shown publicly, and never shown to the person it is about until an
 * admin has reviewed it — publishing "this landlord withheld my deposit"
 * against a named individual, unreviewed, is this platform's largest
 * defamation exposure in South Africa.
 */
export type TenancyFlagReason =
  | 'unpaid_rent'
  | 'property_damage'
  | 'left_without_notice'
  | 'deposit_withheld'
  | 'room_not_as_described'
  | 'unlawful_entry_or_eviction'
  | 'harassment'
  | 'other';

export type TenancyFlagStatus = 'open' | 'upheld' | 'dismissed' | 'withdrawn';

export interface TenancyFlag {
  id: string;
  tenancyId: string;
  reason: TenancyFlagReason;
  detail: string;
  status: TenancyFlagStatus;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

/** The admin queue's shape — /tenancies/flags/open. */
export interface OpenTenancyFlag extends TenancyFlag {
  raisedBy: { id: string; fullName: string; role: string };
  against: { id: string; fullName: string; role: string; openFlagCount: number };
  tenancy: {
    id: string;
    startDate?: string | null;
    endDate?: string | null;
    rentCents: number;
    room?: { id: string; title: string; locationDisplay: string } | null;
  };
}

/**
 * What each reason means, in the words the person reporting would use.
 *
 * Which reasons a person may pick depends on which side of the tenancy they
 * were: a tenant cannot report unpaid rent against their landlord, and
 * offering it would invite a report an admin has to throw away.
 */
export const FLAG_REASONS: Record<TenancyFlagReason, string> = {
  unpaid_rent: 'Rent was not paid',
  property_damage: 'The room or property was damaged',
  left_without_notice: 'They left without notice',
  deposit_withheld: 'My deposit was withheld',
  room_not_as_described: 'The room was not as described',
  unlawful_entry_or_eviction: 'Unlawful entry or eviction',
  harassment: 'Harassment or threats',
  other: 'Something else',
};

export const LANDLORD_FLAG_REASONS: TenancyFlagReason[] = [
  'unpaid_rent', 'property_damage', 'left_without_notice', 'harassment', 'other',
];
export const TENANT_FLAG_REASONS: TenancyFlagReason[] = [
  'deposit_withheld', 'room_not_as_described', 'unlawful_entry_or_eviction', 'harassment', 'other',
];
