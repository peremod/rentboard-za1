-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('plumber', 'electrician', 'locksmith', 'cleaner', 'other');

-- CreateTable
CREATE TABLE "service_providers" (
    "id" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "areas" TEXT[],
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sponsoredUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_providers_category_active_idx" ON "service_providers"("category", "active");
