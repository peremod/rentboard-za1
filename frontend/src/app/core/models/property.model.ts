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
  /**
   * A street address, for the landlord's eyes only — Phase 7b.
   *
   * Optional, and never shown to anybody else: the board shows the suburb and
   * not the street, for the tenant's safety, and nothing on this platform needs
   * a street address. It exists so a landlord with four yards can tell them
   * apart in a list, which is the whole purpose and the reason it can be blank.
   */
  addressLine?: string | null;

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
  /** Live lettings only — pending or active. */
  tenancies: YardTenancy[];
  /**
   * Finished lettings, newest first, capped at six by the API.
   *
   * ⚠️ Optional because an older cached payload will not carry it. The
   * property screen was the only place a landlord could see a tenancy and it
   * asked for pending and active only, so a finished letting took the tenant,
   * the dates and the ledger with it — the landlord half of what Phase D
   * fixed for the tenant, failing the other way.
   */
  pastTenancies?: YardTenancy[];
}

/** One letting on a yard room, live or finished. */
export interface YardTenancy {
  id: string;
  status: string;
  startDate?: string | null;
  /** Set once it has ended. */
  endDate?: string | null;
  /** Set by the nightly pass once the review window closes. */
  archivedAt?: string | null;
  /** While this is in the future, either party may still review. */
  reviewsCloseAt?: string | null;
  rentCents: number;
  tenant: { id: string; fullName: string };
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
  totals: {
    rooms: number;
    vacant: number;
    waitingApplicants: number;
    /**
     * Rooms marked let with nobody in them.
     *
     * Optional: an older cached payload will not carry it. The room-level
     * marker is what a landlord acts on; this is the count, for a header.
     */
    vacantButListedAsLet?: number;
  };
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

/**
 * The tenancy a rent ledger belongs to.
 *
 * ⚠️ This arrives WITH the periods, and that is the whole point. The endpoint
 * used to answer a bare `RentPeriod[]`, so a screen holding a ledger had no
 * way to know whether the letting behind it was running, waiting on a
 * move-in, or finished two years ago — and the tenant's rent screen duly
 * rendered an ended tenancy as a current one. A record whose state you have to
 * guess gets described wrongly.
 */
export interface RentLedgerTenancy {
  id: string;
  status: 'pending' | 'active' | 'ended' | 'cancelled';
  /** Null on a `pending` tenancy: nobody has confirmed the move-in. */
  startDate: string | null;
  endDate: string | null;
  rentCents: number;
  reviewsCloseAt: string | null;
}

/**
 * What `GET /properties/rent/:tenancyId` answers.
 *
 * ⚠️ **Declared once, deliberately.** Two services call that endpoint —
 * `PropertiesService.rentHistory` for the landlord's yard and
 * `RentService.history` for the tenant's rent screen — and the generic on
 * `http.get` is an unchecked cast, so a stale `RentPeriod[]` on either side
 * passes `tsc` and `ng build` and fails at runtime when something calls
 * `.find` on an object. That is exactly what happened to the yard when the
 * envelope landed. One type, imported by both, is what makes the next change
 * to this shape a compile error instead of a blank panel.
 */
export interface RentLedger {
  tenancy: RentLedgerTenancy;
  periods: RentPeriod[];
}

export type ExpenseCategory = 'municipal' | 'water' | 'electricity' | 'maintenance' | 'other';

/** Something the landlord paid for. Hangs off the yard; `room` only when the cost is one room's. */
export interface Expense {
  id: string;
  propertyId: string;
  roomId?: string | null;
  room?: { id: string; title: string } | null;
  category: ExpenseCategory;
  amountCents: number;
  /** The day the money went out, not the day it was typed. */
  incurredOn: string;
  receiptPath?: string | null;
  note?: string | null;
  createdAt: string;
}

/**
 * Rent in, expenses out, for one month.
 *
 * `rentBasis` is carried from the API and SHOWN, not dropped. It says which
 * rent months are counted, and a money figure whose rules are invisible is one
 * someone plans around and is wrong about.
 */
export interface ExpenseSummary {
  month: string;
  properties: {
    propertyId: string;
    name: string;
    rentCents: number;
    expenseCents: number;
    netCents: number;
  }[];
  /** Rent on rooms that are in no yard — reported so the rows need not sum to the total silently. */
  ungroupedRentCents: number;
  totalRentCents: number;
  totalExpenseCents: number;
  netCents: number;
  byCategory: Partial<Record<ExpenseCategory, number>>;
  rentBasis: string;
}

/** Why a tenancy needs attention. The API decides; the screen does not re-derive it. */
export type UpcomingReason = 'lease_ending' | 'notice_given';

/**
 * A tenancy that is about to free up a room.
 *
 * Either a fixed term inside the lead window, or one where notice has been
 * given. A month-to-month tenancy with no notice appears in neither, because
 * nothing is happening to it.
 */
export interface UpcomingLease {
  tenancyId: string;
  room: { id: string; title: string; status: string };
  tenant: { id: string; fullName: string };
  rentCents: number;
  leaseEndDate: string | null;
  noticePeriodDays: number;
  noticeGivenAt: string | null;
  /** 'you' or 'the tenant' — in the landlord's terms, not an id. */
  noticeGivenBy: string | null;
  /** The day the room frees up: notice + period, or the lease end. */
  emptiesOn: string | null;
  daysUntilEmpty: number | null;
  reason: UpcomingReason;
  /** Already past. Shown rather than hidden — an overdue relist is the urgent one. */
  overdue: boolean;
}
