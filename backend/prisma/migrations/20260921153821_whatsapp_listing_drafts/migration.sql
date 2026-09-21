-- CreateEnum
CREATE TYPE "WhatsappDraftStatus" AS ENUM ('collecting', 'ready', 'claimed', 'abandoned');

-- CreateTable
CREATE TABLE "whatsapp_drafts" (
    "id" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "status" "WhatsappDraftStatus" NOT NULL DEFAULT 'collecting',
    "rawText" TEXT,
    "imagePaths" TEXT[],
    "parsedTitle" TEXT,
    "parsedRentCents" INTEGER,
    "parsedRoomType" "RoomType",
    "parsedProvince" TEXT,
    "parsedCity" TEXT,
    "parsedSuburb" TEXT,
    "roomId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_drafts_roomId_key" ON "whatsapp_drafts"("roomId");

-- CreateIndex
CREATE INDEX "whatsapp_drafts_landlordId_status_idx" ON "whatsapp_drafts"("landlordId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_drafts_status_lastMessageAt_idx" ON "whatsapp_drafts"("status", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "whatsapp_drafts" ADD CONSTRAINT "whatsapp_drafts_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
