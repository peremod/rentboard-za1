-- Surveys move from "a landlord profile answered" to "a user answered",
-- gain an edition, and learn the difference between part-answered and done.
--
-- ⚠️ Hand-written rather than taken from `prisma migrate diff`. The generated
-- script DROPs landlordProfileId and ADDs a NOT NULL userId in the same
-- statement, which loses the link on every existing row and fails outright if
-- any exist. This backfills first and only then tightens the column, so a
-- database with answers in it keeps them.
--
-- The backfill maps landlord_profiles."userId". A row that cannot be mapped
-- makes the SET NOT NULL fail, and that is deliberate: a migration that
-- deletes answers it cannot place is worse than one that stops and says so.

-- 1. The new source value. Added, never used in this migration: Postgres
--    refuses to USE a new enum value in the transaction that adds it.
ALTER TYPE "SurveySource" ADD VALUE IF NOT EXISTS 'onboarding';

-- 2. Surveys are versioned. Everything that exists is edition 1.
ALTER TABLE "surveys" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS "surveys_slug_key";
CREATE UNIQUE INDEX "surveys_slug_version_key" ON "surveys"("slug", "version");
CREATE INDEX "surveys_active_slug_idx" ON "surveys"("active", "slug");

-- 3. Responses: keyed on the user, carrying the role answered as.
ALTER TABLE "survey_responses" ADD COLUMN "userId" TEXT;
ALTER TABLE "survey_responses" ADD COLUMN "role" "UserRole";
ALTER TABLE "survey_responses" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "survey_responses" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "survey_responses" r
   SET "userId" = p."userId"
  FROM "landlord_profiles" p
 WHERE p."id" = r."landlordProfileId"
   AND r."landlordProfileId" IS NOT NULL;

UPDATE "survey_responses" r
   SET "role" = u."role"
  FROM "users" u
 WHERE u."id" = r."userId"
   AND r."userId" IS NOT NULL;

-- Everything that existed was answered through the dashboard or the micro
-- prompt, both of which submit the whole set at once: those are complete.
UPDATE "survey_responses" SET "completedAt" = "createdAt" WHERE "completedAt" IS NULL;

ALTER TABLE "survey_responses" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "survey_responses" ALTER COLUMN "role" SET NOT NULL;
DROP INDEX IF EXISTS "survey_responses_surveyId_landlordProfileId_key";
ALTER TABLE "survey_responses" DROP COLUMN "landlordProfileId";
CREATE UNIQUE INDEX "survey_responses_surveyId_userId_key" ON "survey_responses"("surveyId", "userId");
CREATE INDEX "survey_responses_surveyId_role_completedAt_idx" ON "survey_responses"("surveyId", "role", "completedAt");
ALTER TABLE "survey_responses"
  ADD CONSTRAINT "survey_responses_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Dismissals, the same move.
ALTER TABLE "survey_dismissals" ADD COLUMN "userId" TEXT;

UPDATE "survey_dismissals" d
   SET "userId" = p."userId"
  FROM "landlord_profiles" p
 WHERE p."id" = d."landlordProfileId";

ALTER TABLE "survey_dismissals" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX IF EXISTS "survey_dismissals_surveyId_landlordProfileId_key";
ALTER TABLE "survey_dismissals" DROP COLUMN "landlordProfileId";
CREATE UNIQUE INDEX "survey_dismissals_surveyId_userId_key" ON "survey_dismissals"("surveyId", "userId");
ALTER TABLE "survey_dismissals"
  ADD CONSTRAINT "survey_dismissals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
