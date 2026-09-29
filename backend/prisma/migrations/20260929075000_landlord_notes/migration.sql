-- A landlord's private notes about a tenant — Phase 5e.
--
-- BOTH foreign keys cascade, and the second one is the point:
--
--   landlordId -> the author. Their account going takes their notes with it,
--                 because the notes were theirs.
--   tenantId   -> the person the note is ABOUT. Their account going takes it
--                 too. Without this cascade, deleting a tenant would leave
--                 notes about somebody who has asked to be forgotten, which is
--                 a POPIA s.24 problem and not a tidiness one.
CREATE TABLE "landlord_notes" (
    "id" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landlord_notes_pkey" PRIMARY KEY ("id")
);

-- One landlord's notes about one tenant, newest first.
CREATE INDEX "landlord_notes_landlordId_tenantId_createdAt_idx" ON "landlord_notes"("landlordId", "tenantId", "createdAt");

ALTER TABLE "landlord_notes" ADD CONSTRAINT "landlord_notes_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "landlord_notes" ADD CONSTRAINT "landlord_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
