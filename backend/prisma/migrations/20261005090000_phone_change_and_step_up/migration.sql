-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  A PHONE-ONLY ACCOUNT COULD LOCK ITSELF OUT WITH ONE TYPO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Phase 7g gave a person with only a mobile number their own account: no email,
-- no password, `authProvider: 'phone'`, and the verified number as the single
-- credential. It was bolted onto a profile form written for accounts that have
-- an email address, and nobody followed the consequence through. Measured on a
-- real account created through the product's own three-step flow:
--
--   PATCH /api/users/me {"phone": ""}            -> HTTP 500
--   PATCH /api/users/me {"phone": "<one digit out>"} -> HTTP 200
--
-- After the second call the account's phone is the number nobody holds,
-- `phoneVerified` is false, there is no email and there is no password. The
-- number the person actually has in their hand belongs to no account. Asking
-- for a sign-in code on it answers:
--
--   200 "If that number has an account, a code is on its way on WhatsApp."
--
-- and sends nothing, because the enumeration-proof reply is identical whether
-- or not an account exists. So the product reassures them a code is coming,
-- forever, and none ever arrives. `forgot-password` needs an address they do
-- not have. That is a permanent, silent, self-service lockout caused by one
-- mistyped digit — for exactly the WhatsApp-first landlord phone sign-up was
-- built for.
--
-- The 500 is the database holding a line the application does not know about:
-- `users_email_or_phone_required` refuses the row, Prisma throws, and the
-- person gets "Internal server error" rather than a sentence.
--
-- ── What this migration adds
--
-- `newPhone`, mirroring the `newEmail` column beside it, and a `phone_change`
-- token type. Together they make a number change PROVEN BEFORE IT LANDS: the
-- code goes to the new number, the account keeps the old one until the code
-- comes back, and a typo therefore cannot be stored as the way in. The same
-- shape as email changes, which have been confirmed at the new address since
-- before any of this.
--
-- Nothing is backfilled. There is no stored state to migrate: the two existing
-- phone accounts are intact, and a number change had no record of any kind
-- because it was a field edit.

ALTER TABLE "auth_tokens" ADD COLUMN "newPhone" TEXT;

ALTER TYPE "AuthTokenType" ADD VALUE 'phone_change';

-- A phone_change token is meaningless without the number it is proving, and a
-- token carrying a number for any other purpose is a bug. The application
-- checks both; this is the belt, for the same reason the service-provider and
-- viewing constraints exist: a seed script or a second code path must not be
-- able to write a half-formed one.
-- ⚠️ `::text`, not the enum literal.
--
-- Since Postgres 12 `ALTER TYPE ... ADD VALUE` may run inside a transaction,
-- but the value it adds cannot be USED until that transaction commits — and
-- Prisma runs each migration file in one. Written as `"type" = 'phone_change'`
-- this file fails with "unsafe use of new value of enum type". Comparing the
-- cast text compares a string literal instead, which is safe here and means
-- the constraint lands in the same migration as the column it is about.
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_phone_change_needs_number"
  CHECK (
    ("type"::text = 'phone_change' AND "newPhone" IS NOT NULL)
    OR ("type"::text <> 'phone_change' AND "newPhone" IS NULL)
  );
