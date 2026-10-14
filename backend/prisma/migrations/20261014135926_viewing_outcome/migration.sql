-- CreateEnum
CREATE TYPE "ViewingOutcome" AS ENUM ('happened', 'rearranged_privately', 'no_answer', 'fell_through_other_room', 'fell_through_other_tenant');

-- DropIndex
DROP INDEX "account_recoveries_status_createdAt_idx";

-- DropIndex
DROP INDEX "phone_signups_assistedByAdminId_createdAt_idx";

-- DropIndex
DROP INDEX "service_providers_lastCheckedAt_idx";

-- DropIndex
DROP INDEX "users_deactivatedAt_idx";

-- DropIndex
DROP INDEX "users_deletedAt_idx";

-- AlterTable
ALTER TABLE "room_viewings" ADD COLUMN     "outcome" "ViewingOutcome",
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "outcomeById" TEXT,
ADD COLUMN     "outcomeNote" TEXT;

-- CreateIndex
CREATE INDEX "account_recoveries_status_createdAt_idx" ON "account_recoveries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "phone_signups_assistedByAdminId_createdAt_idx" ON "phone_signups"("assistedByAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "room_viewings_status_startsAt_outcome_idx" ON "room_viewings"("status", "startsAt", "outcome");

-- AddForeignKey
ALTER TABLE "room_viewings" ADD CONSTRAINT "room_viewings_outcomeById_fkey" FOREIGN KEY ("outcomeById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
