export type ReviewType = 'room' | 'landlord' | 'tenant';
export type TenancyStatus = 'pending' | 'active' | 'ended' | 'cancelled';

export interface Review {
  id: string;
  type: ReviewType;
  rating: number;
  comment: string;
  publishedAt?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  author?: { fullName: string };
  tenancy?: { id: string; startDate?: string | null; endDate?: string | null };
  createdAt: string;
}

export interface Tenancy {
  id: string;
  roomId: string;
  landlordId: string;
  tenantId: string;
  status: TenancyStatus;
  startDate?: string | null;
  endDate?: string | null;
  rentCents: number;
  reviewsCloseAt?: string | null;
  room?: { id: string; title: string; locationDisplay: string; heroImagePath?: string | null };
  landlord?: { id: string; fullName: string };
  tenant?: { id: string; fullName: string };
  reviews?: { id: string; authorId: string; type: ReviewType; publishedAt?: string | null }[];
}

/** What this user still owes on an ended tenancy, from /tenancies/reviewable. */
export interface ReviewableTenancy {
  tenancy: Tenancy;
  role: 'landlord' | 'tenant';
  outstanding: ReviewType[];
  closesAt?: string | null;
}

/** References are deliberately shaped differently — see ReviewsService. */
export interface TenantReferences {
  reviews: Review[];
  /** Present when there are none, explaining that absence is not a negative. */
  note?: string | null;
}
