-- CreateEnum
CREATE TYPE "RentStatus" AS ENUM ('unpaid', 'paid', 'partial', 'waived');

-- AlterTable
ALTER TABLE "landlord_profiles" ADD COLUMN     "rentGraceDays" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "propertyId" TEXT;

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_periods" (
    "id" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "status" "RentStatus" NOT NULL DEFAULT 'unpaid',
    "amountCents" INTEGER NOT NULL,
    "markedAt" TIMESTAMP(3),
    "markedById" TEXT,
    "tenantDisputedAt" TIMESTAMP(3),
    "tenantNote" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_landlordId_idx" ON "properties"("landlordId");

-- CreateIndex
CREATE INDEX "rent_periods_status_periodStart_idx" ON "rent_periods"("status", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "rent_periods_tenancyId_periodStart_key" ON "rent_periods"("tenancyId", "periodStart");

-- CreateIndex
CREATE INDEX "rooms_propertyId_idx" ON "rooms"("propertyId");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_periods" ADD CONSTRAINT "rent_periods_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "tenancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
