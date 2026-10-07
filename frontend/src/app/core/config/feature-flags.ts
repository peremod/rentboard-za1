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

/**
 * WhatsApp — Phase 8j. False, and false is the decision rather than a pause.
 *
 * Meta bills PER MESSAGE: an authentication message to a South African number
 * is about USD $0.0095 plus VAT, from the very first one, with no free
 * allowance anywhere. A sign-in code is business-initiated by definition, so
 * every single one is chargeable. On a product that is free to list and free
 * to apply, that is a per-head cost with no revenue behind it.
 *
 * ⚠️ This flag hides UI that PROMISES a WhatsApp message will arrive. It does
 * NOT hide wa.me links — sharing a room, or tapping "WhatsApp" on a plumber in
 * the directory, opens the person's own WhatsApp and Meta bills nobody for
 * that. Those are free distribution in this market and they stay.
 *
 * ⚠️ It must agree with WHATSAPP_ENABLED on the API, and the dangerous
 * direction is this one being true while the API is off: that is a button
 * which looks like it works. The API refuses anyway with a 503 naming the
 * alternative, so the worst case is an honest error rather than silence, and
 * scripts/whatsapp-off-drive.mjs asserts the two agree.
 *
 * Turning it back on: set WHATSAPP_ENABLED=true on the API, get an
 * AUTHENTICATION template approved (docs/WHATSAPP-SETUP.md), then flip this.
 */
export const WHATSAPP_ENABLED = false;
