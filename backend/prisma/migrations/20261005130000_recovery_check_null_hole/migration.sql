-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  A CHECK CONSTRAINT THAT PASSED ON NULL — TWO CONTROLS THAT ONLY LOOKED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Both constraints were written in the migration one before this, in the same
-- phase, and both were wrong in the same way:
--
--   CHECK ("refusedAt" IS NULL OR length(btrim("refusedReason")) > 0)
--   CHECK ("idSeenAt"  IS NULL OR length(btrim("idSeenNote"))    > 0)
--
-- `btrim(NULL)` is NULL, `length(NULL)` is NULL, and `NULL > 0` is NULL — and
-- **a CHECK constraint that evaluates to NULL is satisfied.** So a row with
-- `refusedAt` set and `refusedReason` NULL went straight in, which is exactly
-- the row the constraint existed to refuse: a refusal nobody can review, on the
-- most dangerous path in the product.
--
-- Found by the drive, because that drive tests the CONSTRAINTS directly with
-- SQL rather than only testing the service that also enforces them. The
-- service's own checks were fine; a rule only the service holds is one direct
-- UPDATE away from being no rule, which is why those checks exist and why they
-- are tested this way. The sibling constraints in the same migration —
-- `approval_needs_identity_check`, `recovery_needs_approval`,
-- `approval_has_an_approver` — are all of the form `X IS NULL OR Y IS NOT NULL`
-- and have no such hole; they fired correctly.
--
-- `room_viewings_meeting_place_not_blank` uses the same `length(btrim(...))`
-- idiom and is sound only because `meetingPlace` is NOT NULL at the column
-- level. That is luck rather than design, and it is recorded here so the next
-- person writing one of these knows the trap: **always compare the column to
-- NULL explicitly, even when a NOT NULL column makes it moot today.**

ALTER TABLE "account_recoveries"
  DROP CONSTRAINT "account_recoveries_refusal_has_a_reason";

ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_refusal_has_a_reason"
  CHECK (
    "refusedAt" IS NULL
    OR ("refusedReason" IS NOT NULL AND length(btrim("refusedReason")) > 0)
  );

ALTER TABLE "account_recoveries"
  DROP CONSTRAINT "account_recoveries_id_check_has_a_note";

ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_id_check_has_a_note"
  CHECK (
    "idSeenAt" IS NULL
    OR ("idSeenNote" IS NOT NULL AND length(btrim("idSeenNote")) > 0)
  );
