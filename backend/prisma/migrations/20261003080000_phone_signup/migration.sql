-- Phase 7g part two: signing UP by phone, not just signing in.
--
-- A new table rather than columns on `users`, deliberately: a sign-up attempt
-- must not create an account for somebody else's number. See the PhoneSignup
-- model comment in schema.prisma for the full reasoning.
--
-- Purely additive. No existing column, index or constraint is touched, so this
-- is safe to apply to a live database with no downtime window.

CREATE TABLE "phone_signups" (
  "id"                TEXT NOT NULL,
  "phone"             TEXT NOT NULL,
  "codeHash"          TEXT,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "verifiedAt"        TIMESTAMP(3),
  "ticketHash"        TEXT,
  "ticketExpiresAt"   TIMESTAMP(3),
  "consentAcceptedAt" TIMESTAMP(3),
  "userId"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "phone_signups_pkey" PRIMARY KEY ("id")
);

-- One account can only have come from one sign-up.
CREATE UNIQUE INDEX "phone_signups_userId_key" ON "phone_signups"("userId");

-- The ticket is looked up by its hash, and two rows must never share one.
CREATE UNIQUE INDEX "phone_signups_ticketHash_key" ON "phone_signups"("ticketHash");

-- The live-row lookup: the newest unconsumed attempt for a number.
CREATE INDEX "phone_signups_phone_userId_createdAt_idx"
  ON "phone_signups"("phone", "userId", "createdAt");

-- Cascade: a deleted account has no consent left to evidence, and the row holds
-- that person's mobile number.
ALTER TABLE "phone_signups"
  ADD CONSTRAINT "phone_signups_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
