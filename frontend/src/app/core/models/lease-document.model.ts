export type LeaseDocumentKind =
  | 'lease'
  | 'addendum'
  | 'inspection'
  | 'deposit_receipt'
  | 'other';

/**
 * A stored lease document.
 *
 * `path` is deliberately absent. The API never returns the storage location in
 * a list — opening a document asks for it separately, so it is not sitting in
 * every response and every browser history entry.
 *
 * There is no signature field, and that is the feature. Mastande stores what
 * two people signed on paper; it does not witness, execute or timestamp an
 * agreement. See LeaseDocumentsService for why that line is where it is.
 */
export interface LeaseDocument {
  id: string;
  tenancyId: string;
  uploadedById: string;
  kind: LeaseDocumentKind;
  label: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Whether the reader uploaded it, and so may rename or remove it. The API
   *  decides this; the screen must not compare ids and reach its own answer. */
  mine: boolean;
}

/**
 * Where to read one document, fetched only when someone opens it.
 *
 * A signed URL that expires, never the storage path. The admin verification
 * queue has always linked to a bare path instead, which resolved against the
 * app's own origin and so never opened anything — that is the mistake this
 * shape exists to avoid repeating.
 */
export interface LeaseDocumentLocation {
  url: string;
  /** When the URL stops working, so a screen can say so rather than 401. */
  expiresAt: string;
  contentType?: string | null;
  label: string;
}

/** In the landlord's words, not the enum's. */
export const LEASE_DOC_KIND_LABELS: Record<LeaseDocumentKind, string> = {
  lease: 'Signed lease',
  addendum: 'Addendum or renewal',
  inspection: 'Move-in inspection',
  deposit_receipt: 'Deposit proof',
  other: 'Other',
};
