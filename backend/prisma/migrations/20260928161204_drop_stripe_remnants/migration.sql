/*
  Warnings:

  - You are about to drop the column `stripeCustomerId` on the `landlord_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `landlord_profiles` table. All the data in the column will be lost.
  - You are about to drop the `renters_passports` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `room_boosts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "renters_passports" DROP CONSTRAINT "renters_passports_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "room_boosts" DROP CONSTRAINT "room_boosts_roomId_fkey";

-- DropIndex
DROP INDEX "landlord_profiles_stripeCustomerId_key";

-- DropIndex
DROP INDEX "landlord_profiles_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "landlord_profiles" DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId";

-- DropTable
DROP TABLE "renters_passports";

-- DropTable
DROP TABLE "room_boosts";
