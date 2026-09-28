import { Application } from './application.model';

export type RentStatus = 'unpaid' | 'paid' | 'partial' | 'waived';

/**
 * A yard: several rooms at one place.
 *
 * Deliberately carries no street address. The view needs to tell one property
 * from another, which a name and a suburb do — and a room's public page has
 * always shown the suburb rather than the street for the tenant's safety.
 */
export type HousemateProfile = 'professionals' | 'students' | 'mixed' | 'couples' | 'unstated';

export interface Property {
  id: string;
  name: string;
  suburb?: string | null;
  city: string;
  province: string;

  // ── What the whole address shares ────────────────────────────────────────
  //
  // On the property and not on each room: four rooms at one address have one
  // kitchen, one set of rules and one group of housemates, and held per-room
  // the copies drift in front of tenants deciding where to live.

  /** The landlord's own words. Free text, not a checklist. */
  houseRules?: string | null;
  /** What everyone here uses — NOT Room.amenities, which is per room. */
  sharedAmenities?: string[];
  /** People already at the address. Null means not said. */
  currentHousemates?: number | null;
  /** `unstated` is the absence of an answer, never a claim — see the schema. */
  housemateProfile?: HousemateProfile;

  createdAt: string;
  _count?: { rooms: number };
}

/** The result of relisting every relistable room in a yard. */
export interface RelistAllResult {
  relisted: { id: string; title: string }[];
  /** Named, not counted: a landlord needs to know WHICH room was left. */
  skipped: { id: string; title: string; reason: string }[];
}

/** A room as the yard dashboard sees it — enough for a row, not the full record. */
export interface YardRoom {
  id: string;
  title: string;
  status: string;
  rentCents: number;
  locationDisplay: string;
  heroImagePath?: string | null;
  propertyId?: string | null;
  relistCount: number;
  publishedAt?: string | null;
  viewCount: number;
  applications: Pick<Application, 'id' | 'status' | 'createdAt'> &
    { tenant: { id: string; fullName: string; tenantProfile?: { hasPassport: boolean } | null } }[];
  tenancies: {
    id: string;
    status: string;
    startDate?: string | null;
    rentCents: number;
    tenant: { id: string; fullName: string };
  }[];
}

export interface YardGroup {
  property?: Property;
  rooms: YardRoom[];
  roomCount: number;
  vacant: number;
  let: number;
  draft: number;
  paused: number;
  waitingApplicants: number;
}

export interface YardDashboard {
  properties: YardGroup[];
  /** Rooms not in a yard. Never hidden — see PropertiesService.dashboard. */
  ungrouped: YardGroup | null;
  totals: { rooms: number; vacant: number; waitingApplicants: number };
  /** Days after the 1st before an unpaid month triggers a reminder. 0 is off. */
  rentGraceDays: number;
}

/**
 * One month of rent on one tenancy.
 *
 * `status` is the landlord's record. `tenantDisputedAt` is the tenant's
 * answer, which sits beside it and never overwrites it — Mastande has not
 * checked whether money arrived and does not claim to.
 */
export interface RentPeriod {
  id: string;
  tenancyId: string;
  periodStart: string;
  status: RentStatus;
  amountCents: number;
  markedAt?: string | null;
  tenantDisputedAt?: string | null;
  tenantNote?: string | null;
  reminderSentAt?: string | null;
}
