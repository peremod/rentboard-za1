-- AlterTable
ALTER TABLE "tenancies" ADD COLUMN     "leaseEndDate" TIMESTAMP(3),
ADD COLUMN     "noticeGivenAt" TIMESTAMP(3),
ADD COLUMN     "noticeGivenById" TEXT,
ADD COLUMN     "noticePeriodDays" INTEGER NOT NULL DEFAULT 30;
