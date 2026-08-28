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
