/**
 * Temporary feature flags — see PRE-LAUNCH-CHECKLIST.md "Temporarily
 * disabled" section for the reasoning and how to reverse this.
 *
 * BILLING_ENABLED = false: Stripe subscriptions, room boosts, and Renter's
 * Passport are paused. Every landlord is effectively on an unlimited free
 * tier (unlimited listings, 20 photos/room, one-click relist) while this
 * is off. Flip to true once Stripe Dashboard products/prices are set up
 * (see README §18) and the backend's StripeModule is re-registered in
 * app.module.ts.
 */
export const BILLING_ENABLED = false;

/** Free-tier photo cap while billing is paused — mirrors the backend's MAX_GALLERY_PHOTOS + 1 (cover). */
export const MAX_PHOTOS_PER_ROOM = 20;
