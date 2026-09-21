/**
 * Payment figures, in their own file so both sides can read them.
 *
 * VerificationService writes the fee into the audit trail and PaymentsService
 * charges it. Importing the service for the number would close a cycle —
 * PaymentsModule already imports VerificationModule for confirmPaid — and
 * typing it twice is how the trail ends up telling someone they were charged
 * an amount the gateway never took.
 */

/** The once-off landlord verification fee, in ZAR cents. Matches the pricing page. */
export const VERIFICATION_FEE_CENTS = 14900;
