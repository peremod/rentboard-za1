-- What was actually checked about a tradesperson — Phase 7j.
--
-- ── The defect this fixes
--
-- /landlord/services opened with "People we have checked out and can pass on",
-- and its empty state read "It is names we have checked, not an open
-- directory". Nothing on service_providers recorded a check of any kind — no
-- column, no table, nothing. The screen made a trust claim the data could not
-- support, on the one axis this product competes on, and that claim was the
-- only thing a landlord had to go on when deciding whether to let a stranger
-- into their tenant's room.
--
-- Same family as a documentDeletedAt that deleted nothing, except that this one
-- faced the user and asked them to rely on it.
--
-- ── Timestamps, not booleans
--
-- A check has a date or it is a rumour. "Verified" with no date is worth
-- nothing two years later; a landlord deciding today should be able to see that
-- the reference call happened in 2024 and judge for themselves.
--
-- ── Only outcomes
--
-- idCheckedAt records that an identity document was seen. The document is never
-- stored — the same rule verification_requests already follows for tenants and
-- landlords (POPIA s.19 and minimality). What anybody needs is the outcome.
--
-- ── tradeRegistration is free text, deliberately
--
-- "PIRB P12345" for a plumber, a Department of Labour number for an electrician
-- who can issue a Certificate of Compliance. The bodies differ per trade and
-- several trades have none, so an enum would force an admin to either lie or
-- leave it empty. It is shown verbatim so a landlord can check it with the body
-- themselves, which is the only thing that makes it worth storing at all.

ALTER TABLE "service_providers"
  ADD COLUMN "phoneConfirmedAt"   TIMESTAMP(3),
  ADD COLUMN "idCheckedAt"        TIMESTAMP(3),
  ADD COLUMN "referenceCheckedAt" TIMESTAMP(3),
  ADD COLUMN "tradeRegistration"  TEXT,
  ADD COLUMN "lastCheckedAt"      TIMESTAMP(3),
  ADD COLUMN "checkedByAdminId"   TEXT;

-- Existing rows: nothing was ever recorded, so nothing is claimed. They become
-- unpublished rather than silently presented as checked.
--
-- ⚠️ This is the honest migration and it is NOT the convenient one. Any
-- provider already live has no recorded check, and leaving them live would mean
-- the directory still says "we checked these" about rows nobody checked — the
-- exact defect this migration exists to end. An admin re-confirms the number
-- and republishes; that is a few minutes per name against a claim the product
-- cannot otherwise make honestly.
UPDATE "service_providers" SET "active" = false WHERE "active" = true;

-- The rule the application also enforces, kept here so a direct UPDATE cannot
-- get around it. A provider is listed only once somebody has rung the number
-- and reached them: it is the minimum that makes "we can pass this on" true.
ALTER TABLE "service_providers"
  ADD CONSTRAINT "service_providers_active_needs_phone_check"
  CHECK ("active" = false OR "phoneConfirmedAt" IS NOT NULL);

CREATE INDEX "service_providers_lastCheckedAt_idx" ON "service_providers"("lastCheckedAt");
