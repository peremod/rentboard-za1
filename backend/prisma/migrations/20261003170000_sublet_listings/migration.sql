-- Phase 6: tenant sub-letting and shared-lease listings (Option A).
--
-- Additive throughout. No column is dropped, no constraint tightened, and every
-- new column has a default that describes what existing rows already are — so
-- every listing in the database stays exactly what it was: an owner's.
--
-- ⚠️ One thing worth knowing before running this on staging: adding a value to
-- a Postgres enum is allowed inside a transaction (PG 12+, and this is 16), but
-- the new value cannot be USED in that same transaction. This migration only
-- adds it; the first row carrying it is written later, by the application.

-- ── Who is letting the room out ──────────────────────────────────────────
CREATE TYPE "ListerType" AS ENUM ('owner_landlord', 'sublessor');

ALTER TABLE "rooms"
  ADD COLUMN "listerType" "ListerType" NOT NULL DEFAULT 'owner_landlord',
  -- When an admin checked THIS address's lease and consent-to-sublet. A date
  -- rather than a boolean on purpose: what can honestly be shown is "checked on
  -- 14 March", never "may sublet" — the head landlord can withdraw consent the
  -- next day and nothing tells us.
  ADD COLUMN "subletCheckedAt" TIMESTAMP(3);

-- The board's sublet filter runs with the status filter, always.
CREATE INDEX "rooms_status_listerType_idx" ON "rooms"("status", "listerType");

-- ── How the household runs, for the compatibility filters ────────────────
CREATE TYPE "HouseholdSchedule" AS ENUM ('weekday_working', 'shift_work', 'mostly_home', 'varied', 'unstated');
CREATE TYPE "HouseholdCleanliness" AS ENUM ('very_tidy', 'tidy_enough', 'relaxed', 'unstated');
CREATE TYPE "HouseholdSocial" AS ENUM ('social', 'quiet', 'balanced', 'unstated');

-- Defaulted to 'unstated', which is a distinct value from any answer and is
-- never rendered. Defaulting to a real answer would put a claim about the
-- people somebody would be living with in front of them that nobody made.
ALTER TABLE "properties"
  ADD COLUMN "householdSchedule"    "HouseholdSchedule"    NOT NULL DEFAULT 'unstated',
  ADD COLUMN "householdCleanliness" "HouseholdCleanliness" NOT NULL DEFAULT 'unstated',
  ADD COLUMN "householdSocial"      "HouseholdSocial"      NOT NULL DEFAULT 'unstated';

-- ── The sub-letting right, as a verification about one listing ───────────
ALTER TYPE "VerificationType" ADD VALUE IF NOT EXISTS 'sublet_right';

ALTER TABLE "verification_requests" ADD COLUMN "roomId" TEXT;
CREATE INDEX "verification_requests_roomId_idx" ON "verification_requests"("roomId");

-- SetNull, not Cascade: deleting a listing must not erase the record that a
-- document was checked, and by whom. The same call as Expense.roomId.
ALTER TABLE "verification_requests"
  ADD CONSTRAINT "verification_requests_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
