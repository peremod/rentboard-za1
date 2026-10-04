import { Room } from './room.model';

export type ApplicationStatus = 'pending' | 'viewed' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn';

export interface ApplicationTenant {
  id: string;
  fullName: string;
  email: string;
  avatarPath?: string | null;
  isVerified: boolean;
  /**
   * The Renter's Passport flag, for the badge on the applicant card. What the
   * badge rests on is fetched separately when a landlord opens the applicant
   * — see VerificationService.badgeBasis.
   */
  tenantProfile?: { hasPassport: boolean; passportExpiresAt: string | null } | null;
}

export interface Application {
  id: string;
  roomId: string;
  tenantId: string;
  status: ApplicationStatus;
  /** When the landlord accepted or rejected. Drives the 30-minute undo window. */
  decidedAt?: string | null;
  /** True once the room was relisted or let to someone else. */
  isArchived?: boolean;
  /** Human-readable reason, present only when isArchived. */
  archivedReason?: string | null;
  /** Letting cycle this application belongs to. */
  cycle?: number;
  coverNote?: string | null;
  room?: Room;
  tenant?: ApplicationTenant;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of the portfolio-wide applicants view — Phase 7c.
 *
 * An `Application` with the three things the per-room screen could not show,
 * because per-room is exactly the scope it lacked: which property the room
 * sits on, whether anything is waiting on the landlord, and where the
 * conversation last happened.
 */
export interface ApplicantInboxRow extends Omit<Application, 'room'> {
  /**
   * Only the fields this list draws, and NOT the `Room` model.
   *
   * `Room.property` is the shared-living block (house rules, amenities) that
   * the detail response flattens off the Property record. Here `property` is
   * the Property itself — its id and name — because that is what this screen
   * filters and groups by. Two different things behind one word, which is
   * pre-existing and worth knowing before reusing either.
   */
  room: {
    id: string;
    title: string;
    status: string;
    rentCents: number;
    relistCount: number;
    property: { id: string; name: string } | null;
  };
  messageCount: number;
  /** From the applicant and never opened. */
  unreadMessages: number;
  /** Never opened, or they have said something since you last looked. */
  needsAttention: boolean;
  lastMessage: {
    body: string;
    channel: 'in_app' | 'whatsapp';
    createdAt: string;
    fromTenant: boolean;
  } | null;
}

export interface ApplicantInbox {
  data: ApplicantInboxRow[];
  total: number;
  needsAttention: number;
}

/** Query for `GET /applications/inbox`. Mirrors ApplicantInboxDto. */
export interface ApplicantInboxFilters {
  roomId?: string;
  propertyId?: string;
  status?: ApplicationStatus;
  sortBy?: 'newest' | 'unread';
}
