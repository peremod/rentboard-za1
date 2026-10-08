-- Tenancy archive, and reports scoped to the letting they are about.
-- Phase B of docs/TENANCY-LIFECYCLE-AUDIT.md.
--
-- ⚠️ HAND-EDITED, deliberately. `prisma migrate dev` generated this file with
-- five extra DROP INDEX / CREATE INDEX pairs that have nothing to do with the
-- change:
--
--     account_recoveries_status_createdAt_idx
--     phone_signups_assistedByAdminId_createdAt_idx
--     service_providers_lastCheckedAt_idx
--     users_deactivatedAt_idx
--     users_deletedAt_idx
--
-- They are pre-existing DRIFT between the schema and the database, not part of
-- this work — confirmed by running `prisma migrate diff` with this migration's
-- schema changes stashed, which emits the same five pairs on its own. Two of
-- them differ only by sort order (the database holds `"createdAt" DESC`, the
-- schema declares plain `createdAt`).
--
-- They were removed because dropping and recreating an index on `users` is a
-- real operation on the busiest table in this database, and it has no business
-- riding along with a feature migration. Drift deserves its own migration,
-- its own reasoning and its own runbook line. See docs/OUTSTANDING.md §31.
--
-- Consequence to know about: the next `prisma migrate dev` will offer those
-- five pairs again, because the drift is still there. That is expected. Do not
-- fold them into whatever you are working on either.

-- ── reports: which letting the complaint is about ─────────────────────────
-- Nullable, and never backfilled. Most reports come from people with no
-- tenancy at all, and inferring which letting a historical report belonged to
-- from a room id and a date would manufacture facts about a complaint.
ALTER TABLE "reports" ADD COLUMN "tenancyId" TEXT;

-- SetNull, not Cascade: deleting a tenancy must not delete the report. A
-- room's safety history is what a future tenant needs most and it outlives any
-- one letting.
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenancyId_fkey"
  FOREIGN KEY ("tenancyId") REFERENCES "tenancies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reports_tenancyId_idx" ON "reports"("tenancyId");

-- ── tenancies: finished, and finished-and-closed ──────────────────────────
-- `archivedAt` splits the two jobs `ended` was doing: "ended last week,
-- reviews open, both parties still acting on it" and "ended in 2024,
-- read-only". Null on every existing row — no backfill, because guessing which
-- historical tenancies were closed would manufacture facts, and a null simply
-- means not yet archived.
--
-- `noticeRecordedById` is who ENTERED the notice, as against `noticeGivenById`
-- which is who it is attributed to. Without the distinction there is no safe
-- withdrawal rule, which is why a tenant could not give notice at all.
ALTER TABLE "tenancies" ADD COLUMN "archivedAt" TIMESTAMP(3),
                        ADD COLUMN "noticeRecordedById" TEXT;

-- The archive listings, both sides: a sub-lessor is a landlord of one room and
-- a tenant of another, and their history is one list (Phase 6).
CREATE INDEX "tenancies_tenantId_archivedAt_idx" ON "tenancies"("tenantId", "archivedAt");
CREATE INDEX "tenancies_landlordId_archivedAt_idx" ON "tenancies"("landlordId", "archivedAt");
-- The nightly pass: ended, window closed, not yet archived.
CREATE INDEX "tenancies_status_archivedAt_idx" ON "tenancies"("status", "archivedAt");
