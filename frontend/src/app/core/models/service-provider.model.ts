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
