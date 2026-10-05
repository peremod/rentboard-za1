/**
 * The four documents a landlord keeps asking for — Phase 8a.
 *
 * ⚠️ TWO OF THESE ARE CONTRACTS AND TWO ARE NOT. That distinction runs through
 * the whole feature and is why `reviewState` exists.
 *
 * A move-in inspection is a checklist and a deposit receipt is a receipt: if the
 * wording is clumsy somebody is mildly inconvenienced. A lease agreement and a
 * renewal addendum create binding obligations, and if a clause in one is wrong
 * the person harmed is a landlord with four back rooms who trusted us. Mastande
 * is not a law firm and this file is not legal advice.
 *
 * So the contracts ship marked `awaiting_legal_review` and say so on their own
 * face, in print as well as on screen — the same outstanding review that
 * /legal/sublet is waiting on. They are still downloadable, deliberately: a
 * landlord who cannot get one here will take a worse one off a search result
 * with no warning on it at all. What they must not do is look finished.
 *
 * ── Why these are printable pages and not generated PDFs
 *
 * No PDF library is added. The browser already has one, every Android phone can
 * reach it through Chrome's Print → Save as PDF, and it renders fonts correctly
 * on a device we cannot test. A server-side renderer would be a dependency, a
 * font-licensing question and a layout we could not check on the handset this
 * product is built for.
 *
 * ── The statutory references
 *
 * Deliberately few, and only where the Act says something a landlord needs to
 * act on. Each is the Rental Housing Act 50 of 1999 unless named otherwise.
 * Padding a template with section numbers makes it look authoritative, which is
 * the opposite of what an unreviewed document should look like.
 */

export type ReviewState = 'ready' | 'awaiting_legal_review';

export interface TemplateField {
  /** What goes on the line. Printed as a label with a rule beside it. */
  label: string;
  /** Roughly how much room to leave. */
  size?: 'short' | 'long' | 'block';
  hint?: string;
}

export interface TemplateSection {
  heading: string;
  /** Plain paragraphs. */
  body?: string[];
  fields?: TemplateField[];
  /** Rows of a table, for inspections. */
  checklist?: string[];
  /** Shown in a tinted box — something the person must not miss. */
  note?: string;
}

export interface DocTemplate {
  slug: string;
  title: string;
  /** One line, on the card. */
  purpose: string;
  /** Who fills it in. */
  who: string;
  reviewState: ReviewState;
  /** Why it matters, in the landlord's terms. Shown on the card and the page. */
  why: string;
  sections: TemplateSection[];
  /** Signature blocks at the end. */
  signatories: string[];
}

const SIGN_BOTH = ['Landlord', 'Tenant'];

export const TEMPLATES: DocTemplate[] = [
  // ── 1. Move-in / move-out inspection ────────────────────────────────────
  //
  // The highest-value one, and the lowest risk. s.5(3)(e)-(g) make the joint
  // inspection a statutory step, and s.5(3)(g) is the sharp end: a landlord who
  // does not inspect is DEEMED to acknowledge the room was in good order, which
  // means no deduction later. A landlord who skips this has already lost the
  // deposit argument and usually does not know it.
  {
    slug: 'move-in-inspection',
    title: 'Room inspection — moving in and moving out',
    purpose: 'Record the condition of the room, with the tenant there, before they move in.',
    who: 'Landlord and tenant together, at the room.',
    reviewState: 'ready',
    why:
      'The Rental Housing Act expects you and the tenant to inspect the room together before they '
      + 'move in, and again before they leave. If you do not do the outgoing inspection, the Act '
      + 'treats you as having agreed the room was in good order — and you cannot then deduct for '
      + 'damage. This one page is what protects a deposit deduction months later.',
    sections: [
      {
        heading: 'Who and where',
        fields: [
          { label: 'Landlord', size: 'short' },
          { label: 'Tenant', size: 'short' },
          { label: 'Address of the room', size: 'long' },
          { label: 'Room / unit', size: 'short' },
          { label: 'Date of this inspection', size: 'short' },
          { label: 'This is the', size: 'short', hint: 'moving-in or moving-out inspection' },
        ],
      },
      {
        heading: 'Condition, item by item',
        note:
          'Write what you both actually see. "Scratch on the left door panel" is worth more later '
          + 'than "fair". Anything left blank will be read as "no problem".',
        checklist: [
          'Door, lock and keys',
          'Windows and burglar bars',
          'Walls and paint',
          'Ceiling',
          'Floor or floor covering',
          'Light fittings and switches',
          'Plug points',
          'Built-in cupboard',
          'Bed / furniture provided',
          'Taps, basin or sink',
          'Toilet',
          'Shower or bath',
          'Geyser / hot water',
          'Prepaid meter number and reading',
          'Water meter reading (if separate)',
          'Shared areas the tenant may use',
          'Anything else',
        ],
      },
      {
        heading: 'Keys and things handed over',
        fields: [
          { label: 'Keys handed over (how many, for what)', size: 'long' },
          { label: 'Remote / gate tag', size: 'short' },
          { label: 'Anything else handed over', size: 'long' },
        ],
      },
      {
        heading: 'Agreed before moving in',
        fields: [
          { label: 'Repairs the landlord will do, and by when', size: 'block' },
          { label: 'Anything the tenant is not responsible for', size: 'block' },
        ],
      },
      {
        heading: 'At the end of the lease — moving out',
        note:
          'Do this one within three days before the lease ends, with the tenant there. Compare it '
          + 'against the moving-in page above. Fair wear and tear is not damage.',
        fields: [
          { label: 'Date of the moving-out inspection', size: 'short' },
          { label: 'Differences from the moving-in condition', size: 'block' },
          { label: 'Agreed deductions, if any, and why', size: 'block' },
        ],
      },
    ],
    signatories: SIGN_BOTH,
  },

  // ── 2. Deposit receipt ──────────────────────────────────────────────────
  //
  // ⚠️ Mastande does not hold deposits and this template must not read as
  // though it does. It is the LANDLORD's receipt to their own tenant. The
  // interest point is s.5(3)(c): the deposit is invested in an interest-bearing
  // account and the interest is the tenant's, which a lot of small landlords do
  // not know and which costs them at the tribunal.
  {
    slug: 'deposit-receipt',
    title: 'Deposit receipt and record',
    purpose: 'Give the tenant written proof of what they paid you, and on what terms.',
    who: 'The landlord writes it; the tenant keeps a copy.',
    reviewState: 'ready',
    why:
      'A deposit argument twelve months from now is decided by paper. This is the paper. It also '
      + 'records the two things the Act expects of you: that the deposit sits in an interest-bearing '
      + 'account, and that the interest belongs to the tenant.',
    sections: [
      {
        heading: 'The payment',
        fields: [
          { label: 'Received from (tenant)', size: 'short' },
          { label: 'Amount received', size: 'short', hint: 'in words and in figures' },
          { label: 'Date received', size: 'short' },
          { label: 'Paid by', size: 'short', hint: 'cash, EFT, other' },
          { label: 'Reference, if an EFT', size: 'short' },
          { label: 'For the room at', size: 'long' },
        ],
      },
      {
        heading: 'What this money is',
        body: [
          'This is a rental deposit. It is not rent. It is held against damage beyond fair wear '
          + 'and tear, and against anything the tenant owes at the end of the lease.',
        ],
        fields: [
          { label: 'Rent for the first month, if paid at the same time', size: 'short' },
        ],
        note:
          'Keep the deposit separate from your own money. The Rental Housing Act expects it to be '
          + 'held in an interest-bearing account, and the interest earned belongs to the tenant, '
          + 'not to you.',
      },
      {
        heading: 'Where it is held',
        fields: [
          { label: 'Bank', size: 'short' },
          { label: 'Type of account', size: 'short' },
        ],
      },
      {
        heading: 'Getting it back',
        body: [
          'After the moving-out inspection, the deposit and the interest it earned are refunded to '
          + 'the tenant, less anything you and the tenant agreed is owed.',
          'The Act sets the time limits: within 7 days of the outgoing inspection if nothing is '
          + 'deducted, and within 14 days if there are deductions, with receipts for the repairs.',
        ],
        fields: [
          { label: 'Refund to (account name and number)', size: 'long' },
        ],
      },
    ],
    signatories: SIGN_BOTH,
  },

  // ── 3. Lease agreement ──────────────────────────────────────────────────
  //
  // ⚠️ A CONTRACT. awaiting_legal_review, and the page says so in print.
  {
    slug: 'lease-agreement',
    title: 'Room lease agreement',
    purpose: 'A written lease for a single room, in plain language.',
    who: 'Landlord and tenant, signed by both.',
    reviewState: 'awaiting_legal_review',
    why:
      'A lease does not have to be in writing to be valid, but the Act says you must put it in '
      + 'writing if the tenant asks — and a written one is what settles an argument. This is a '
      + 'starting point for a single let room, not a full property lease.',
    sections: [
      {
        heading: 'The parties',
        fields: [
          { label: 'Landlord (full name)', size: 'short' },
          { label: 'Landlord ID number', size: 'short' },
          { label: 'Landlord contact number', size: 'short' },
          { label: 'Address for notices to the landlord', size: 'long' },
          { label: 'Tenant (full name)', size: 'short' },
          { label: 'Tenant ID number', size: 'short' },
          { label: 'Tenant contact number', size: 'short' },
        ],
      },
      {
        heading: 'The room',
        fields: [
          { label: 'Address', size: 'long' },
          { label: 'Which room', size: 'short' },
          { label: 'Shared areas the tenant may use', size: 'long' },
          { label: 'How many people may live in the room', size: 'short' },
        ],
      },
      {
        heading: 'How long',
        fields: [
          { label: 'Start date', size: 'short' },
          { label: 'End date', size: 'short' },
          { label: 'Notice either side must give to end it', size: 'short' },
        ],
      },
      {
        heading: 'Rent',
        fields: [
          { label: 'Rent per month', size: 'short' },
          { label: 'Due on which day of the month', size: 'short' },
          { label: 'How it is paid', size: 'short' },
          { label: 'What happens if it is late', size: 'block' },
        ],
      },
      {
        heading: 'Deposit',
        fields: [
          { label: 'Deposit amount', size: 'short' },
        ],
        note:
          'The deposit goes into an interest-bearing account and the interest belongs to the '
          + 'tenant. Use the deposit receipt template to record it.',
      },
      {
        heading: 'Electricity, water and rubbish',
        fields: [
          { label: 'Who pays for electricity, and how', size: 'block' },
          { label: 'Who pays for water', size: 'block' },
        ],
      },
      {
        heading: 'House rules',
        fields: [{ label: 'The rules both sides agree to', size: 'block' }],
      },
      {
        heading: 'Repairs',
        fields: [
          { label: 'What the landlord fixes', size: 'block' },
          { label: 'What the tenant is responsible for', size: 'block' },
          { label: 'How to report something broken', size: 'short' },
        ],
      },
      {
        heading: 'Inspections',
        body: [
          'The landlord and tenant inspect the room together before the tenant moves in, and again '
          + 'before the lease ends. Both inspections are written down and signed.',
        ],
      },
      {
        heading: 'Ending the lease',
        fields: [
          { label: 'How either side ends it early, and what that costs', size: 'block' },
        ],
      },
    ],
    signatories: SIGN_BOTH,
  },

  // ── 4. Addendum / renewal ───────────────────────────────────────────────
  //
  // ⚠️ A CONTRACT. awaiting_legal_review.
  {
    slug: 'lease-addendum',
    title: 'Lease addendum or renewal',
    purpose: 'Change one thing in an existing lease, or carry it on for another term.',
    who: 'Landlord and tenant, signed by both, kept with the original lease.',
    reviewState: 'awaiting_legal_review',
    why:
      'Changing the rent or the end date in a WhatsApp message is how arguments start. This is one '
      + 'page that attaches to the lease you already have and says exactly what changed and from when. '
      + 'Everything you do not mention stays as it was.',
    sections: [
      {
        heading: 'Which lease this changes',
        fields: [
          { label: 'Landlord', size: 'short' },
          { label: 'Tenant', size: 'short' },
          { label: 'Address and room', size: 'long' },
          { label: 'Date of the original lease', size: 'short' },
        ],
      },
      {
        heading: 'What is changing',
        note: 'Fill in only the lines that change. Anything left blank stays exactly as it is in the original lease.',
        fields: [
          { label: 'New rent per month, if it is changing', size: 'short' },
          { label: 'From which date', size: 'short' },
          { label: 'New end date, if the lease is carrying on', size: 'short' },
          { label: 'Anything else that is changing', size: 'block' },
        ],
      },
      {
        heading: 'Everything else',
        body: [
          'Every other term of the original lease stays as it is, and both sides remain bound by it.',
        ],
      },
    ],
    signatories: SIGN_BOTH,
  },
];

export function templateBySlug(slug: string): DocTemplate | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
