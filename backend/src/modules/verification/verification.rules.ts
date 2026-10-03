import { VerificationType, UserRole } from '@prisma/client';

/**
 * What each verification type is, who may submit it, and what it proves.
 *
 * One table rather than conditionals scattered through the service, because
 * three separate things key off these facts — who is allowed to submit a type,
 * whether it carries the fee, and which profile flag approval sets — and they
 * drifted apart the moment they were written separately.
 *
 * The income proofs exist because this market is informal. A credit check
 * needs a credit history; most South African renters do not have one, and the
 * ones who need most to prove they can pay are exactly the ones a bureau
 * cannot see. Every type below is a document a person already has, or a phone
 * call to someone who already knows them.
 */
export interface VerificationRule {
  /**
   * Who may submit this type. A landlord cannot submit a SASSA letter; a
   * tenant cannot submit a title deed.
   *
   * `BOTH` exists for identity alone, and getting that wrong is what the
   * first end-to-end run caught: identity was marked LANDLORD, which meant a
   * tenant could not submit it — and since a Tenant Passport requires
   * identity AND an income proof, no tenant could ever have earned one. The
   * whole feature was unreachable through a single field.
   */
  subject: 'LANDLORD' | 'TENANT' | 'BOTH';
  /** False only for landlord_reference, which is a phone call, not a file. */
  needsDocument: boolean;
  /**
   * Does approval count as proof of income for the Tenant Passport?
   * Identity is not income; a bank statement is.
   */
  provesIncome: boolean;
  /** Shown in the UI and written into the audit trail. */
  label: string;
  /** What the person is actually being asked to upload. */
  guidance: string;
  /**
   * Is this check about one LISTING rather than about the person — Phase 6.
   *
   * True only for `sublet_right`. The right to sublet comes from one lease over
   * one address: somebody allowed to sublet in Yeoville is not thereby allowed
   * to sublet in Soweto, so the request carries a `roomId` and the approval
   * stamps that room. Every other type is a fact about the person and carries
   * no room.
   *
   * It also keeps the type out of the list offered to people who have no
   * sublet listing — see VerificationService.availableTypes.
   */
  aboutAListing?: boolean;
}

export const VERIFICATION_RULES: Record<VerificationType, VerificationRule> = {
  identity: {
    // Both sides. A landlord proves who they are so a tenant knows who holds
    // their deposit; a tenant proves it so the Passport means something. The
    // fee is what differs, not the check — see requiresPayment.
    subject: 'BOTH',
    needsDocument: true,
    provesIncome: false,
    label: 'Identity',
    guidance: 'A photo of your green ID book, smart ID card, or passport.',
  },
  proof_of_address: {
    subject: 'LANDLORD',
    needsDocument: true,
    provesIncome: false,
    label: 'Proof of address',
    guidance: 'A municipal bill or bank statement from the last three months showing your address.',
  },
  proof_of_ownership: {
    subject: 'LANDLORD',
    needsDocument: true,
    provesIncome: false,
    label: 'Proof you may let the room',
    guidance: 'A title deed, or a written mandate from the owner allowing you to let.',
  },

  // ── Tenant income proofs ──
  sassa_grant: {
    subject: 'TENANT',
    needsDocument: true,
    provesIncome: true,
    label: 'SASSA grant confirmation',
    guidance:
      'Your SASSA payment confirmation letter, or a screenshot of the SASSA status check showing an approved grant. A grant is income — it arrives monthly, on a known date, for a known amount.',
  },
  employer_confirmation: {
    subject: 'TENANT',
    needsDocument: true,
    provesIncome: true,
    label: 'Employer confirmation',
    guidance:
      'A letter, WhatsApp message or SMS from your employer confirming that you work there and what you are paid. A screenshot is fine — most jobs in this market do not come with a payslip.',
  },
  bank_statement: {
    subject: 'TENANT',
    needsDocument: true,
    provesIncome: true,
    label: 'Three months of bank activity',
    guidance:
      'Screenshots from your banking app covering the last three months, showing money coming in. Cover or crop your account number — we do not need it and should not hold it.',
  },
  sublet_right: {
    // BOTH, and not TENANT, even though Option A expects sub-lessors to be
    // tenant accounts. A landlord who owns a yard in Tembisa may also rent a
    // flat in town and sublet its spare room — `listerType` is a fact about a
    // listing, not about a person, and a rule keyed to role would deny that
    // person the only check that makes their sublet listing trustworthy.
    subject: 'BOTH',
    needsDocument: true,
    provesIncome: false,
    aboutAListing: true,
    label: 'Your right to sublet this place',
    guidance:
      'Two things, in one or two photos: your own lease for this address, and either the clause in it that allows you to sublet, or a written message from your landlord saying you may. A WhatsApp message from them is fine. We check that the documents exist and match the address — we do not confirm with your landlord, and we cannot promise an applicant that your right to sublet is valid.',
  },
  landlord_reference: {
    subject: 'TENANT',
    needsDocument: false,
    provesIncome: true,
    label: 'Previous landlord reference',
    guidance:
      'The name and mobile number of a landlord you have rented from before. We message them once to ask whether you paid on time. They do not need an account.',
  },
};

/**
 * Types a given role may submit. Used by the API and to build the UI list.
 *
 * `hasSubletListing` keeps `sublet_right` out of the list for the vast majority
 * who have none. It is a list-building concern only: `maySubmit` still allows
 * the type, because the submission itself is validated against a real sublet
 * listing the person owns, which is a stronger check than this one.
 */
export function typesFor(role: UserRole, hasSubletListing = false): VerificationType[] {
  const subject = role === 'LANDLORD' ? 'LANDLORD' : 'TENANT';
  return (Object.keys(VERIFICATION_RULES) as VerificationType[]).filter((type) => {
    const rule = VERIFICATION_RULES[type];
    if (rule.aboutAListing && !hasSubletListing) return false;
    return rule.subject === subject || rule.subject === 'BOTH';
  });
}

/** Whether this role may submit this type at all. */
export function maySubmit(type: VerificationType, role: UserRole): boolean {
  const rule = VERIFICATION_RULES[type];
  if (!rule) return false;
  if (rule.subject === 'BOTH') return true;
  return rule.subject === (role === 'LANDLORD' ? 'LANDLORD' : 'TENANT');
}

/**
 * Whether this submission must be paid for before review.
 *
 * Only a landlord's identity check carries the R149 fee, exactly as
 * docs/DATA-AND-MONETISATION.md §5 prices it. Everything a tenant submits is
 * free, and that is not an oversight to be tidied up later: "free to apply,
 * always" is the whole position against RoomKing, AmaRoom, Gumtree and
 * Facebook, and charging the side of this market with the least money to
 * prove they are poor enough to need a room would be the single fastest way
 * to lose it. See docs/DATA-AND-MONETISATION.md §4 for the revenue mix that
 * replaces it.
 */
export function requiresPayment(type: VerificationType, role: UserRole): boolean {
  // `sublet_right` is free, and not by omission. A sub-lessor is listing a
  // room, and listing is free on this platform — charging them to prove they
  // may sublet would be a landlord listing fee wearing a different name, which
  // is the one thing this product does not do. It is also the check that
  // protects the APPLICANT, so putting a paywall in front of it would price
  // trust out of exactly the listings that need it most.
  return role === 'LANDLORD' && type === 'identity';
}
