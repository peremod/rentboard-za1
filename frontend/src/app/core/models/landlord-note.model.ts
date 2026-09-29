/** A landlord's private note about a tenant. Theirs alone — see the schema. */
export interface LandlordNote {
  id: string;
  landlordId: string;
  tenantId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** The grouped "all my notes" view: one entry per person. */
export interface NotesForTenant {
  tenantId: string;
  tenantName: string;
  notes: LandlordNote[];
}

export type CalendarKind = 'rent_due' | 'lease_ends' | 'notice_expires' | 'room_free';

/**
 * One dated thing on the landlord's calendar.
 *
 * `date` is a plain YYYY-MM-DD, never a timestamp. "Rent is due on the 1st" is
 * not an instant, and treating it as one shows a South African landlord the 31st.
 * Parse it by splitting the string, not with `new Date(...)`.
 */
export interface CalendarEntry {
  date: string;
  kind: CalendarKind;
  title: string;
  detail: string | null;
  tenancyId: string | null;
  roomTitle: string | null;
}
