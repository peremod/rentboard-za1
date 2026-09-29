-- Phone as a login identifier, and email no longer required — Phase 7g.
--
-- Many township landlords are WhatsApp-first and do not use email. Requiring one
-- meant turning them away or inventing an address on their behalf, and an
-- invented address is one nobody reads: a password reset or an "you have an
-- applicant" notice would go nowhere while looking delivered.

-- 1. Email becomes optional. Widening a NOT NULL to nullable rewrites no rows
--    and cannot fail.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- 2. At least one contact method, enforced where it cannot be bypassed.
--
--    "Either email or phone" is not something Prisma can express, and it is far
--    too important to leave to whichever code path happens to run — an account
--    with neither is an account nobody can ever sign into or notify.
--
--    NOT VALID, then VALIDATE, so the ACCESS EXCLUSIVE lock is held only for the
--    catalogue change and the scan runs without blocking writes. On a small table
--    this is indistinguishable; on a large one it is the difference between a
--    deploy and an outage.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_or_phone_required"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL) NOT VALID;
ALTER TABLE "users" VALIDATE CONSTRAINT "users_email_or_phone_required";

-- 3. Phone uniqueness — PARTIAL, on verified numbers only.
--
--    This column has never been unique, so duplicates already exist: the dev
--    database had forty accounts on one number, and production may have people
--    who mistyped or a household sharing a handset. A full unique index would
--    fail to create, and the only way to force it would be to null out other
--    people's saved numbers — destroying user data to satisfy a constraint.
--
--    Verified numbers are the ones that decide a login: requestCode only ever
--    finds a user with phoneVerified = true, so unverified duplicates cannot make
--    "sign in with your phone" ambiguous. Two verified duplicates could, and this
--    makes that impossible.
--
--    If this statement fails, TWO VERIFIED ACCOUNTS SHARE A NUMBER. Do not
--    force it through by nulling one — find out which is the real person:
--      SELECT id, email, phone, "createdAt", "lastLoginAt" FROM users
--       WHERE phone IN (SELECT phone FROM users WHERE "phoneVerified"
--                        GROUP BY phone HAVING count(*) > 1);
CREATE UNIQUE INDEX "users_phone_verified_key"
  ON "users"("phone") WHERE "phoneVerified" = true;

-- 4. Somewhere to count wrong guesses.
--
--    phone-otp.service.ts had a MAX_ATTEMPTS = 5 constant that nothing read: it
--    described an intention and counted nothing, and its own header says so.
--    There was nowhere to count. The existing @Throttle is per IP — ten guesses
--    per IP per fifteen minutes — so a distributed attacker gets more than one
--    budget while the account owner gets one. This is per token, so the budget
--    belongs to the account.
ALTER TABLE "auth_tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
