-- CreateEnum
CREATE TYPE "HousemateProfile" AS ENUM ('professionals', 'students', 'mixed', 'couples', 'unstated');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "currentHousemates" INTEGER,
ADD COLUMN     "houseRules" TEXT,
ADD COLUMN     "housemateProfile" "HousemateProfile" NOT NULL DEFAULT 'unstated',
ADD COLUMN     "sharedAmenities" TEXT[];
