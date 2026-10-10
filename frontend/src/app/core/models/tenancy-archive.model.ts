/**
 * A finished letting, as a complete record — Phase F.
 *
 * ⚠️ The fields that are ABSENT here are as deliberate as the ones present.
 * There are no landlord notes (private to their author, never part of a shared
 * record) and no message thread (it lives at /account/messages, keyed on the
 * application, and a second copy would mean two places to get read-state
 * wrong). The API says so in its own `excluded` block rather than leaving a
 * reader to assume.
 */

export type ArchiveRole = 'landlord' | 'tenant';

/** One row in the list. Counts rather than contents — see ArchiveRecord. */
export interface ArchiveListRow {
  id: string;
  /** `cancelled` means nobody ever moved in. Labelled, not hidden. */
  status: 'ended' | 'cancelled';
  startDate: string | null;
  endDate: string | null;
  rentCents: number;
  archivedAt: string | null;
  /** Which side this person was, so the row can name the other one. */
  role: ArchiveRole;
  otherParty: { id: string; fullName: string } | null;
  room: { id: string; title: string; locationDisplay: string } | null;
  monthsRecorded: number;
  documentCount: number;
  /** The one time-limited thing about a finished letting. */
  reviewsOpen: boolean;
}

export interface ArchiveRentPeriod {
  id: string;
  periodStart: string;
  status: 'unpaid' | 'paid' | 'partial' | 'waived';
  amountCents: number;
  markedAt: string | null;
  tenantDisputedAt: string | null;
  tenantNote: string | null;
}

export interface ArchiveReview {
  id: string;
  type: 'room' | 'landlord' | 'tenant';
  rating: number;
  comment: string;
  publishedAt: string | null;
  response: string | null;
  respondedAt: string | null;
  authorId: string;
  subjectId: string | null;
  author: { id: string; fullName: string } | null;
}

/** A private report to the platform. Only ever the ones YOU raised. */
export interface ArchiveFlag {
  id: string;
  reason: string;
  detail: string;
  status: 'open' | 'upheld' | 'dismissed' | 'withdrawn';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ArchiveDocument {
  id: string;
  kind: string;
  label: string;
  sizeBytes: number | null;
  contentType: string | null;
  uploadedById: string;
  createdAt: string;
  /** Said by the API rather than worked out here by comparing ids. */
  mine: boolean;
}

export interface ArchiveViewing {
  id: string;
  startsAt: string;
  status: 'proposed' | 'accepted' | 'declined' | 'cancelled';
  meetingPlace: string;
  respondedAt: string | null;
  cancelledAt: string | null;
}

export interface ArchiveReport {
  id: string;
  reason: string;
  details: string;
  status: 'open' | 'investigating' | 'actioned' | 'dismissed';
  resolutionNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ArchiveRecord {
  tenancy: {
    id: string;
    status: 'ended' | 'cancelled';
    startDate: string | null;
    endDate: string | null;
    rentCents: number;
    archivedAt: string | null;
    reviewsCloseAt: string | null;
    endReason: string | null;
    leaseEndDate: string | null;
    noticePeriodDays: number;
    noticeGivenAt: string | null;
    createdAt: string;
    role: ArchiveRole;
    otherParty: { id: string; fullName: string } | null;
    room: { id: string; title: string; locationDisplay: string; propertyId: string | null } | null;
    /** Resolved against the reader, so no screen compares ids to say "you". */
    endedBy: 'you' | 'them' | null;
    noticeGivenBy: 'you' | 'them' | null;
    reviewsOpen: boolean;
  };
  rent: {
    periods: ArchiveRentPeriod[];
    monthsRecorded: number;
    monthsPaid: number;
    monthsUnpaid: number;
    monthsDisputed: number;
  };
  /** Published and un-hidden only — the double-blind rule, enforced server-side. */
  reviews: ArchiveReview[];
  flags: ArchiveFlag[];
  documents: ArchiveDocument[];
  application: {
    id: string;
    status: string;
    createdAt: string;
    viewedAt: string | null;
    decidedAt: string | null;
    coverNote: string | null;
  } | null;
  viewings: ArchiveViewing[];
  reports: ArchiveReport[];
  /** What the record deliberately does not contain, and why. */
  excluded: { landlordNotes: string; messages: string };
}
