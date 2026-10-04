export type ServiceCategory = 'plumber' | 'electrician' | 'locksmith' | 'cleaner' | 'other';

/**
 * Someone a landlord can phone when something breaks.
 *
 * Admin-curated — there is no landlord-facing way to add one. See the schema
 * note for why.
 */
export interface ServiceProvider {
  id: string;
  category: ServiceCategory;
  name: string;
  /** E.164, so tel: and wa.me links can be built without guessing. */
  phone: string;
  whatsapp: boolean;
  areas: string[];
  note?: string | null;
  active: boolean;
  /** Present for a future paid placement. Nothing reads it. */
  sponsoredUntil?: string | null;
  createdAt: string;

  // ── What was actually checked — Phase 7j ─────────────────────────────────
  //
  // ⚠️ The screen claimed this before any of it existed: it opened with
  // "People we have checked out and can pass on" while nothing on the model
  // recorded a check of any kind. These are the real outcomes, and the screen
  // now states WHICH are present rather than asserting that someone checked.
  //
  // Dates rather than booleans: a check has a date or it is a rumour.

  /** We rang the number and reached them. Required for a provider to be listed. */
  phoneConfirmedAt?: string | null;
  /** An identity document was seen. The document itself is never stored. */
  idCheckedAt?: string | null;
  /** We spoke to a landlord they have worked for. */
  referenceCheckedAt?: string | null;
  /** A registration as its body issues it, e.g. "PIRB P12345". Shown verbatim. */
  tradeRegistration?: string | null;
  lastCheckedAt?: string | null;
}

/**
 * What we can honestly say about this person, in the order a landlord cares.
 *
 * Built from the stored outcomes so the screen cannot say more than the data
 * holds — which is the whole point of the phase that added them. A provider
 * with nothing recorded returns an EMPTY list, and the screen says so rather
 * than falling back to a reassuring phrase.
 */
export function checksFor(p: ServiceProvider): { label: string; on: string }[] {
  const out: { label: string; on: string }[] = [];
  if (p.phoneConfirmedAt) out.push({ label: 'We rang this number and reached them', on: p.phoneConfirmedAt });
  if (p.idCheckedAt) out.push({ label: 'We saw an identity document', on: p.idCheckedAt });
  if (p.referenceCheckedAt) out.push({ label: 'We spoke to a landlord they have worked for', on: p.referenceCheckedAt });
  return out;
}

/** Plain English, in a landlord's words. */
export const SERVICE_LABELS: Record<ServiceCategory, string> = {
  plumber: 'Plumber',
  electrician: 'Electrician',
  locksmith: 'Locksmith',
  cleaner: 'Cleaner',
  other: 'Something else',
};

/**
 * A wa.me link from an E.164 number.
 *
 * wa.me wants digits only — the leading '+' produces a broken link that lands
 * the landlord on an error page blaming them. Shared so the two screens that
 * build this cannot disagree about it.
 */
export function whatsappLink(phoneE164: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}`;
}
