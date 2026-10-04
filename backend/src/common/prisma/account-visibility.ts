/**
 * The one definition of "this account should be visible to the public".
 *
 * ── Why it is a constant and not three copies of a where clause
 *
 * Phase 7g added two states a user can be in, and each one has to be invisible
 * to the public:
 *
 *   · `deactivatedAt` — the owner paused it. Sign-in still works (that is how
 *     they come back) so `isActive` is deliberately left TRUE, which means
 *     every existing `user: { isActive: true }` filter would have kept showing
 *     their public page, their storefront and their rooms. A pause that leaves
 *     your shop window lit is not a pause.
 *   · `deletedAt` — the account is over.
 *
 * Three services and the sitemap each had their own `isActive: true`, and this
 * codebase has already paid for that shape of duplication: the portal nav was
 * defined six times and the copies disagreed until a landlord's sidebar shrank
 * as they walked through their own portal. A visibility rule that disagrees
 * with itself is worse than a nav that does — one of the copies shows a
 * deactivated person's details to the public.
 *
 * Use it as a nested filter (`user: PUBLIC_USER`) or spread it into a user
 * query (`where: { ...PUBLIC_USER, role: 'LANDLORD' }`).
 */
export const PUBLIC_USER = {
  /** The admin suspension switch. False means locked out by us. */
  isActive: true,
  /** The owner's own pause. */
  deactivatedAt: null,
  /** Ended. The row survives as a tombstone; it is nobody. */
  deletedAt: null,
} as const;

/**
 * The same rule for a sign-in lookup, where a DEACTIVATED account must still be
 * found — otherwise reactivating is impossible and the control is a trapdoor.
 */
export const SIGN_IN_USER = {
  isActive: true,
  deletedAt: null,
} as const;
