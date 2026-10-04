-- Who ended an account, and why — Phase 7i.
--
-- ── Why this table exists
--
-- Closing an account erases the email, the name and the phone number in the
-- same transaction that sets `deletedAt`. After it runs, the only trace that
-- the row ever belonged to a particular person is a `logger.warn` line — and
-- logs rotate. "Who closed this account, and on whose instruction?" is a
-- question an operator gets months later, from a person or from a regulator,
-- and a rotated log file is not an answer.
--
-- Suspension did not need this: it is reversible and the row keeps its email,
-- so the account itself is the record. Closure is neither.
--
-- ── What it deliberately does NOT hold
--
-- No email, no name, no phone number, no IP address. An audit trail that keeps
-- the personal information the erasure removed defeats the erasure it audits.
-- The user id is sufficient and is not personal information on its own: the
-- tombstone row survives for ever (because deleting it would cascade into other
-- people's applications, conversations, tenancies and reviews — see
-- 20261004170000_account_lifecycle), so the id still resolves. It resolves to
-- "Former member".
--
-- ── Both actors, one table
--
-- The owner's own closures are recorded here too, not just the admin ones, so
-- this is the complete record rather than half of one — and so a single code
-- path writes it. Two paths writing two tables is how they drift and one stops
-- recording.
--
-- ── The foreign keys
--
-- `userId` CASCADEs: if a tombstone row is ever genuinely removed (it is not,
-- today, and the lifecycle migration explains why), its closure record goes
-- with it rather than pointing at nothing.
--
-- `closedByAdminId` SET NULLs: an admin may later close their own account, and
-- their tombstone survives, so the reference holds. SET NULL is the safe
-- behaviour if a row is ever really deleted — losing which admin acted is bad,
-- losing the fact that a closure happened would be worse.

CREATE TYPE "AccountClosureActor" AS ENUM ('owner', 'admin');

CREATE TABLE "account_closures" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "actor"           "AccountClosureActor" NOT NULL,
  "closedByAdminId" TEXT,
  "reason"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_closures_pkey" PRIMARY KEY ("id")
);

-- One closure per account: the tombstone is permanent, so the record is too.
CREATE UNIQUE INDEX "account_closures_userId_key" ON "account_closures"("userId");
CREATE INDEX "account_closures_closedByAdminId_idx" ON "account_closures"("closedByAdminId");
CREATE INDEX "account_closures_createdAt_idx" ON "account_closures"("createdAt");

ALTER TABLE "account_closures"
  ADD CONSTRAINT "account_closures_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_closures"
  ADD CONSTRAINT "account_closures_closedByAdminId_fkey"
  FOREIGN KEY ("closedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
