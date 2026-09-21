-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refundDueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "payments_refundDueAt_refundedAt_idx" ON "payments"("refundDueAt", "refundedAt");
