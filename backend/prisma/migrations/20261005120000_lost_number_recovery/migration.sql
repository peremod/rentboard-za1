-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  THE ONLY PATH IN THIS PRODUCT THAT CAN HAND SOMEBODY ELSE'S ACCOUNT OVER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- An account made from a mobile number has no email and no password. Phase 7o
-- made the number changeable, PROVEN FIRST — the code goes to the new number and
-- the account keeps the old one until it answers. That covers switching SIMs,
-- which is the common case, and it covers nothing at all when the phone is gone:
-- every route needs the old number in hand.
--
-- So this is the lost-number path, and it is the most dangerous thing in the
-- codebase. The account on the other side of it holds rooms, applications,
-- tenancies, a rent record and conversations with tenants. Getting it wrong does
-- not inconvenience somebody; it hands a stranger a landlord's entire history
-- with the people living in their rooms.
--
-- ── What makes it defensible, and what does not
--
-- Two separate proofs, neither sufficient alone:
--
--   1. A PERSON proves identity to an admin, offline, and the admin records
--      WHAT was checked and WHEN. Named, dated outcomes — the pattern this
--      codebase already uses for contractor checks and verification requests.
--      An approval with no recorded check is refused by a CHECK constraint
--      below, not merely by the service.
--   2. The NEW HANDSET answers a code. The admin cannot type a number in and
--      have it become the way in; somebody has to be holding that phone.
--
-- And the narrowing that matters most: **this flow is refused outright when the
-- account has an email address or a password.** Then there is a safer, self-service
-- way in and no human needs to be trusted at all. The dangerous path stays as
-- small as it can be.
--
-- ── ⚠️ What this CANNOT do, stated rather than implied
--
-- It cannot warn the real owner in time. The notice is written the moment a
-- request is opened, to every channel the account has — and in the case this
-- exists for there is no email and the owner cannot sign in to read a Notice.
-- So in that case the warning arrives only once they are back in, after the
-- fact. There is no honest way around that: a person with no email, no password
-- and no phone has no channel left. The mitigation is the record, not the
-- notice: every recovery is permanent, attributable, and reconstructable in a
-- dispute, and the recovered account is shown what happened and when.
--
-- A SECOND admin approval would be the standard control here, and it is
-- deliberately not required: Mastande is run by one person with four back rooms,
-- so a two-admin rule would make the feature unusable by the only admin there
-- is. It is recorded as a decision in docs/OUTSTANDING.md rather than quietly
-- skipped — if the team ever has two people, the column to add is obvious.
--
-- ── POPIA
--
-- Only outcomes persist. `idSeenNote` is what the admin saw, in their words;
-- there is deliberately NO documentPath, the same rule as VerificationRequest
-- (s.19, and minimality — the outcome is what anybody needs later). The row
-- cascades with the account (s.24). A request that nobody completes holds the
-- new number of somebody who was never recovered, so it expires and is pruned.

CREATE TYPE "AccountRecoveryStatus" AS ENUM ('open', 'approved', 'recovered', 'refused', 'expired');

CREATE TABLE "account_recoveries" (
  "id" TEXT NOT NULL,

  "userId" TEXT NOT NULL,

  -- Canonical +27 form. The number being claimed, proven by a code before it
  -- replaces anything.
  "newPhone" TEXT NOT NULL,
  -- What the account had when the request was opened. Kept because the user row
  -- will not hold it afterwards, and an audit that cannot say what was replaced
  -- is not one.
  "oldPhone" TEXT NOT NULL,

  "status" "AccountRecoveryStatus" NOT NULL DEFAULT 'open',

  "openedByAdminId" TEXT,

  -- What was actually checked. Dates, not booleans: "we verified them" with no
  -- date is worth nothing in a dispute two years later.
  "idSeenAt" TIMESTAMP(3),
  "idSeenNote" TEXT,
  "knowledgeCheckedAt" TIMESTAMP(3),
  "knowledgeCheckedNote" TEXT,

  "approvedByAdminId" TEXT,
  "approvedAt" TIMESTAMP(3),

  "refusedAt" TIMESTAMP(3),
  "refusedReason" TEXT,

  -- The code proving the new handset. HMAC, same scheme as every other code
  -- here: a read-only database leak must not hand out live codes.
  "codeHash" TEXT,
  "codeExpiresAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,

  "recoveredAt" TIMESTAMP(3),

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "account_recoveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on both admin references: an admin closing their own account must not
-- delete the record of a recovery they handled. The same reasoning as the
-- closure audit and the assisted-signup column.
ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_openedByAdminId_fkey"
  FOREIGN KEY ("openedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_approvedByAdminId_fkey"
  FOREIGN KEY ("approvedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ⚠️ The rules, in the database as well as the service.
--
-- The service checks all of these. They are here too because the rule matters
-- more than the route: a seed script, a direct UPDATE, or a second admin
-- surface somebody adds later must not be able to approve a hand-over with no
-- recorded identity check. That is the lesson of the nineteen @Throttle
-- decorators with no guard registered.

-- An approval requires a recorded identity check. This is the one that matters.
ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_approval_needs_identity_check"
  CHECK ("approvedAt" IS NULL OR "idSeenAt" IS NOT NULL);

-- Nothing is recovered that was not approved first.
ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_recovery_needs_approval"
  CHECK ("recoveredAt" IS NULL OR "approvedAt" IS NOT NULL);

-- An approval has an approver, and a refusal has a reason somebody can read.
ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_approval_has_an_approver"
  CHECK ("approvedAt" IS NULL OR "approvedByAdminId" IS NOT NULL);

ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_refusal_has_a_reason"
  CHECK ("refusedAt" IS NULL OR length(btrim("refusedReason")) > 0);

-- A recorded check says what was seen. An outcome with no words is a tick box.
ALTER TABLE "account_recoveries"
  ADD CONSTRAINT "account_recoveries_id_check_has_a_note"
  CHECK ("idSeenAt" IS NULL OR length(btrim("idSeenNote")) > 0);

-- ⚠️ ONE open or approved request per account.
--
-- A partial unique index, because Prisma cannot express "unique where status in
-- (…)" — the same limitation the contractor-lead work hit. Two live requests on
-- one account is two people being told they are about to get it.
CREATE UNIQUE INDEX "account_recoveries_one_live_per_account"
  ON "account_recoveries" ("userId")
  WHERE "status" IN ('open', 'approved');

CREATE INDEX "account_recoveries_status_createdAt_idx"
  ON "account_recoveries" ("status", "createdAt" DESC);
CREATE INDEX "account_recoveries_newPhone_idx" ON "account_recoveries" ("newPhone");
