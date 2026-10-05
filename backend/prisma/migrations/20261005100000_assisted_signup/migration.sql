-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  HELP REACHES THE HANDSET. CONSENT STOPS AT THE PERSON.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Assisted sign-up — the last of the three items Phase 7g left behind.
--
-- The flow needed almost nothing, because the control that matters was already
-- there and the service's own header says so: `complete` requires
-- `acceptTerms: true` from the request and records WHEN against the row that
-- proved the number. A helper cannot reach that step without the six-digit code,
-- and the code goes to the person's own handset. So an agent can sit beside a
-- landlord with a cheap Android phone and work the form, and the acceptance
-- still has to come from the person holding it.
--
-- What was missing was only the record of WHO HELPED. This column is that.
--
-- ── Why an admin and not anybody signed in
--
-- There is no agent role in this product, and inventing one here would be a
-- product decision made in a migration. Worse, opening an assisted start to any
-- signed-in account would be a way to send sign-up codes to arbitrary numbers
-- with somebody else's name on the record — harassment with an audit trail
-- pointing at the wrong person.
--
-- So it is admin-recorded, the same shape as admin-initiated account closure in
-- Phase 7i: a trusted person acts, and the row says which one.
--
-- ── POPIA
--
-- An abandoned assisted attempt is the mobile number of somebody who never
-- joined, and it is pruned daily by the existing job along with every other
-- abandoned attempt — this column changes nothing about that. On a COMPLETED
-- row it is the audit trail for a real account, and `phone_signups.userId`
-- already cascades, so it leaves with the account (s.24).
--
-- ON DELETE SET NULL, not CASCADE: an admin closing their own account must not
-- delete the sign-up records of the people they helped. The same reasoning as
-- `ViewingsCancelled` and the closure audit — the record of the event outlives
-- the staff member, with the name dropped.

ALTER TABLE "phone_signups" ADD COLUMN "assistedByAdminId" TEXT;

ALTER TABLE "phone_signups"
  ADD CONSTRAINT "phone_signups_assistedByAdminId_fkey"
  FOREIGN KEY ("assistedByAdminId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- For "the sign-ups I started", which is the screen that makes the record
-- readable rather than merely stored.
CREATE INDEX "phone_signups_assistedByAdminId_createdAt_idx"
  ON "phone_signups" ("assistedByAdminId", "createdAt" DESC);
