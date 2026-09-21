/**
 * Verification, both sides of the market.
 *
 * The four income proofs exist because this market is informal. A credit
 * check needs a credit history, and the people who most need to prove they
 * can pay rent are exactly the ones a bureau cannot see — so the checks are
 * documents a South African renter already has, plus a phone call to someone
 * who has already housed them.
 */
export type VerificationType =
  // Either side
  | 'identity'
  // Landlord
  | 'proof_of_address'
  | 'proof_of_ownership'
  // Tenant income proofs
  | 'sassa_grant'
  | 'employer_confirmation'
  | 'bank_statement'
  | 'landlord_reference';

export type VerificationStatus =
  /** Document uploaded, R149 fee not yet paid. Landlord identity only. */
  | 'pending_payment'
  | 'pending'
  | 'approved'
  | 'rejected';

/** Who performed a step in a verification's history. */
export type VerificationActor = 'applicant' | 'admin' | 'system';

/**
 * One step in a verification's history.
 *
 * The reason a badge can show its working. `detail` describes what was done —
 * never what a document said, which is deleted on decision.
 */
export interface VerificationEvent {
  id: string;
  actor: VerificationActor;
  step: string;
  detail?: string | null;
  createdAt: string;
}

export type ReferenceStatus =
  | 'awaiting_contact'
  | 'contacted'
  | 'confirmed'
  | 'disputed'
  /** Nobody answered before the link expired. Says nothing about the tenant. */
  | 'unreachable';

/**
 * A previous landlord, as the tenant sees their own submission and as an
 * admin sees it in the queue.
 *
 * Everything here was typed in by the tenant or answered by the referee.
 * Notably absent: responseTokenHash and tokenExpiresAt. The token is what
 * authenticates the referee, and it never leaves the server.
 */
export interface LandlordReferenceSummary {
  refereeName: string;
  refereePhone: string;
  propertyDescription?: string | null;
  tenancyStartedAt?: string | null;
  tenancyEndedAt?: string | null;
  status: ReferenceStatus;
  rating?: number | null;
  comment?: string | null;
  contactedAt?: string | null;
  respondedAt?: string | null;
}

/** What each type is, and what the person is being asked for. Served by the API. */
export interface VerificationTypeInfo {
  type: VerificationType;
  label: string;
  guidance: string;
  needsDocument: boolean;
  provesIncome: boolean;
  requiresPayment: boolean;
}

/**
 * A verification request.
 *
 * There is no documentPath: the API withholds it from the subject's own view
 * and clears it entirely once reviewed. Only the outcome and its trail are
 * kept, because an ID document is special personal information under
 * POPIA s.26.
 */
export interface VerificationRequest {
  id: string;
  userId: string;
  type: VerificationType;
  label: string;
  status: VerificationStatus;
  hasDocument: boolean;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  documentDeletedAt?: string | null;
  createdAt: string;
  events?: VerificationEvent[];
  reference?: LandlordReferenceSummary | null;
}

/** What a landlord may see about an applicant's badge: outcomes only. */
export interface BadgeBasis {
  checks: { type: VerificationType; label: string; confirmedAt: string | null }[];
  hasPassport: boolean;
  passportExpiresAt: string | null;
  idVerified: boolean;
}

/** A previous landlord's view of the reference they were asked for. */
export interface ReferenceRequestView {
  refereeName: string;
  tenantName: string;
  propertyDescription?: string | null;
  tenancyStartedAt?: string | null;
  tenancyEndedAt?: string | null;
}
