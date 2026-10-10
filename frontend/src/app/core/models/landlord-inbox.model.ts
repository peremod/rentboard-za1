export type InboxKind =
  | 'application_waiting'
  | 'lease_ending'
  | 'notice_given'
  | 'rent_unmarked'
  | 'rent_disputed'
  | 'unread_message'
  /**
   * A room marked let with nobody in it — a letting ended and it was never put
   * back on the board.
   *
   * ⚠️ This is a TASK and not a notice on purpose. Ending a tenancy sends
   * `room_needs_relisting` once, and a notice read and not acted on is gone;
   * the room then sits off the public board and out of the sitemap with
   * nothing on any screen saying so. A task persists until the state changes,
   * which is what "this room is empty and nobody can find it" needs.
   */
  | 'room_vacant';

/**
 * One thing waiting on the landlord.
 *
 * Everything needed to render and act on the row is here, including where the
 * action goes. Deliberately: the inbox is a list of unlike things, and a
 * template deciding each one's destination is a template that will get one
 * wrong the next time a kind is added.
 */
export interface InboxItem {
  kind: InboxKind;
  /** The API's ordering. The screen renders in the order it is given. */
  urgency: number;
  title: string;
  detail: string | null;
  entityId: string;
  roomTitle: string | null;
  daysUntil: number | null;
  actionLabel: string;
  actionPath: string;
}

export interface LandlordInbox {
  items: InboxItem[];
  counts: Record<InboxKind, number>;
}

/**
 * Phase 5d. Every figure carries what it was computed from, and any figure with
 * too little behind it is `null` rather than a rounded guess — `null` occupancy
 * means nothing has been measured, not that nothing is occupied.
 */
export interface LandlordHealth {
  rooms: { total: number; live: number; occupied: number; vacant: number };
  occupancyPct: number | null;
  daysToFill: number | null;
  daysToFillFrom: number;
  paymentReliabilityPct: number | null;
  paymentReliabilityFrom: number;
  /** The whole thing as a paragraph, built server-side beside the numbers. */
  summary: string;
}
