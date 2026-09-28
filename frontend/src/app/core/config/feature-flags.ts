/**
 * Temporary feature flags — see PRE-LAUNCH-CHECKLIST.md "Temporarily
 * disabled" section for the reasoning and how to reverse this.
 *
 * BILLING_ENABLED = false gates exactly one thing now: the room boost button
 * on the landlord dashboard. Every landlord is on an unlimited free tier
 * (unlimited listings, 20 photos/room, one-click relist), and that is the
 * product, not a pause — see /pricing and Terms §4.
 *
 * It used to gate more, and the leftovers were worth removing rather than
 * keeping warm. The subscription page it guarded (/landlord/upgrade, Pro
 * R349/mo, Agency R1,499/mo) has been deleted: Stripe does not operate in
 * South Africa for receiving payments and PayFast recurring was never built,
 * so those prices could never be charged — but they stayed in the build long
 * enough to be copied into the Terms as a binding subscription table. The
 * Renter's Passport is free and no longer gated at all. Navbar and the tenant
 * dashboard each read this flag into a field nothing used.
 *
 * So: flipping this to true turns the boost button back on and nothing else.
 * Restoring paid plans means building the page and a recurring-billing
 * provider first, and updating Terms §4 before either ships.
 */
export const BILLING_ENABLED = false;

/** Free-tier photo cap while billing is paused — mirrors the backend's MAX_GALLERY_PHOTOS + 1 (cover). */
export const MAX_PHOTOS_PER_ROOM = 20;
