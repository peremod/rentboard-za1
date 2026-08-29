export type VerificationType = 'identity' | 'proof_of_address' | 'proof_of_ownership';
export type VerificationStatus =
  /** Document uploaded, R149 fee not yet paid. Not in the admin queue. */
  | 'pending_payment'
  | 'pending'
  | 'approved'
  | 'rejected';

/**
 * A landlord's verification request.
 *
 * Note there is no documentPath: the API withholds it from the landlord's own
 * view and clears it entirely once reviewed. Only the outcome is retained,
 * because an ID document is special personal information under POPIA s.26.
 */
export interface VerificationRequest {
  id: string;
  userId: string;
  type: VerificationType;
  status: VerificationStatus;
  hasDocument: boolean;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  documentDeletedAt?: string | null;
  createdAt: string;
}
