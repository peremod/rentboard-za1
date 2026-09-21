-- CreateEnum
CREATE TYPE "VerificationActor" AS ENUM ('applicant', 'admin', 'system');

-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('awaiting_contact', 'contacted', 'confirmed', 'disputed', 'unreachable');

-- CreateEnum
CREATE TYPE "TenancyFlagReason" AS ENUM ('unpaid_rent', 'property_damage', 'left_without_notice', 'deposit_withheld', 'room_not_as_described', 'unlawful_entry_or_eviction', 'harassment', 'other');

-- CreateEnum
CREATE TYPE "TenancyFlagStatus" AS ENUM ('open', 'upheld', 'dismissed', 'withdrawn');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationType" ADD VALUE 'sassa_grant';
ALTER TYPE "VerificationType" ADD VALUE 'employer_confirmation';
ALTER TYPE "VerificationType" ADD VALUE 'bank_statement';
ALTER TYPE "VerificationType" ADD VALUE 'landlord_reference';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "openFlagCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "verification_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actor" "VerificationActor" NOT NULL,
    "actorId" TEXT,
    "step" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landlord_references" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "refereeName" TEXT NOT NULL,
    "refereePhone" TEXT NOT NULL,
    "propertyDescription" TEXT,
    "tenancyStartedAt" TIMESTAMP(3),
    "tenancyEndedAt" TIMESTAMP(3),
    "status" "ReferenceStatus" NOT NULL DEFAULT 'awaiting_contact',
    "rating" INTEGER,
    "comment" TEXT,
    "responseTokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "contactedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landlord_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy_flags" (
    "id" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "againstId" TEXT NOT NULL,
    "reason" "TenancyFlagReason" NOT NULL,
    "detail" TEXT NOT NULL,
    "status" "TenancyFlagStatus" NOT NULL DEFAULT 'open',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenancy_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_events_requestId_createdAt_idx" ON "verification_events"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_references_requestId_key" ON "landlord_references"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_references_responseTokenHash_key" ON "landlord_references"("responseTokenHash");

-- CreateIndex
CREATE INDEX "landlord_references_status_idx" ON "landlord_references"("status");

-- CreateIndex
CREATE INDEX "tenancy_flags_againstId_status_idx" ON "tenancy_flags"("againstId", "status");

-- CreateIndex
CREATE INDEX "tenancy_flags_status_createdAt_idx" ON "tenancy_flags"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenancy_flags_tenancyId_raisedById_key" ON "tenancy_flags"("tenancyId", "raisedById");

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "verification_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_references" ADD CONSTRAINT "landlord_references_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "verification_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_flags" ADD CONSTRAINT "tenancy_flags_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "tenancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_flags" ADD CONSTRAINT "tenancy_flags_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_flags" ADD CONSTRAINT "tenancy_flags_againstId_fkey" FOREIGN KEY ("againstId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
