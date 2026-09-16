-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('TENANT', 'LANDLORD', 'ADMIN');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('shared_house', 'en_suite', 'studio', 'private');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('draft', 'active', 'reserved', 'let', 'paused', 'deleted');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'pro', 'agency');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'viewed', 'shortlisted', 'accepted', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('not_a_real_listing', 'agent_posing_as_landlord', 'upfront_payment_demanded', 'discriminatory', 'misleading_details', 'harassment', 'already_let', 'other');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'investigating', 'actioned', 'dismissed');

-- CreateEnum
CREATE TYPE "TenancyStatus" AS ENUM ('pending', 'active', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('room', 'landlord', 'tenant');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('transactional', 'marketing');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('hard_bounce', 'complaint', 'unsubscribed', 'manual');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('landlord_verification', 'room_boost');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('new', 'contacted', 'won', 'lost');

-- CreateEnum
CREATE TYPE "PlaceType" AS ENUM ('province', 'city', 'suburb');

-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('board_sidebar', 'board_inline', 'room_detail');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('draft', 'pending_review', 'active', 'paused', 'rejected', 'ended');

-- CreateEnum
CREATE TYPE "ReferralCodeType" AS ENUM ('user', 'launch');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'qualified', 'rewarded', 'void');

-- CreateEnum
CREATE TYPE "ReferralReward" AS ENUM ('none', 'free_verification');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('password_reset', 'email_change', 'magic_link', 'phone_otp');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('instant', 'daily', 'off');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('identity', 'proof_of_address', 'proof_of_ownership');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending_payment', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('rentboard', 'whatsapp');

-- CreateEnum
CREATE TYPE "PassportStatus" AS ENUM ('pending', 'active', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'TENANT',
    "fullName" TEXT NOT NULL,
    "avatarPath" TEXT,
    "phone" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "authProvider" TEXT NOT NULL DEFAULT 'email',
    "authProviderId" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "marketingEmails" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landlord_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT,
    "planTier" "PlanTier" NOT NULL DEFAULT 'free',
    "planExpiresAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "landlord_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employmentStatus" TEXT,
    "annualIncomeCents" INTEGER,
    "incomeVerified" BOOLEAN NOT NULL DEFAULT false,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "hasPassport" BOOLEAN NOT NULL DEFAULT false,
    "passportExpiresAt" TIMESTAMP(3),

    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RoomStatus" NOT NULL DEFAULT 'draft',
    "rentCents" INTEGER NOT NULL,
    "depositCents" INTEGER,
    "billsIncluded" BOOLEAN NOT NULL DEFAULT false,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "locationDisplay" TEXT NOT NULL,
    "availableFrom" TIMESTAMP(3) NOT NULL,
    "housematesCount" INTEGER NOT NULL DEFAULT 0,
    "couplesAllowed" BOOLEAN NOT NULL DEFAULT false,
    "dssAccepted" BOOLEAN NOT NULL DEFAULT false,
    "guarantorAccepted" BOOLEAN NOT NULL DEFAULT false,
    "petsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heroImagePath" TEXT,
    "imagePaths" TEXT[],
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "featuredUntil" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "applicationCount" INTEGER NOT NULL DEFAULT 0,
    "relistCount" INTEGER NOT NULL DEFAULT 0,
    "letAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "coverNote" TEXT,
    "rejectionReason" TEXT,
    "viewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "newEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "roomId" TEXT,
    "reportedUserId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "resolutionNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancies" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "TenancyStatus" NOT NULL DEFAULT 'pending',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "rentCents" INTEGER NOT NULL,
    "endedById" TEXT,
    "endReason" TEXT,
    "reviewsCloseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "subjectId" TEXT,
    "roomId" TEXT,
    "type" "ReviewType" NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_rooms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "notifiedUnavailableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "toEmail" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'queued',
    "providerId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "referenceId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'payfast',
    "merchantReference" TEXT NOT NULL,
    "providerReference" TEXT,
    "itnPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisers" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "imagePath" TEXT,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Learn more',
    "targetUrl" TEXT NOT NULL,
    "province" TEXT,
    "city" TEXT,
    "suburbSlug" TEXT,
    "roomType" "RoomType",
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "monthlyRateCents" INTEGER NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'draft',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "isHouseAd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_enquiries" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "industry" TEXT,
    "message" TEXT NOT NULL,
    "province" TEXT,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'new',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PlaceType" NOT NULL,
    "parentId" TEXT,
    "city" TEXT,
    "province" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ux_counters" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ux_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ReferralCodeType" NOT NULL DEFAULT 'user',
    "ownerId" TEXT,
    "city" TEXT,
    "province" TEXT,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "referrerId" TEXT,
    "refereeId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "qualifyingAction" TEXT,
    "qualifiedAt" TIMESTAMP(3),
    "reward" "ReferralReward" NOT NULL DEFAULT 'none',
    "rewardedAt" TIMESTAMP(3),
    "rewardUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT,
    "city" TEXT,
    "roomType" "RoomType",
    "maxRentCents" INTEGER,
    "minRentCents" INTEGER,
    "billsIncluded" BOOLEAN,
    "couplesAllowed" BOOLEAN,
    "dssAccepted" BOOLEAN,
    "guarantorAccepted" BOOLEAN,
    "petsAllowed" BOOLEAN,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'instant',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "lastNotifiedAt" TIMESTAMP(3),
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "documentPath" TEXT,
    "documentDeletedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'rentboard',
    "body" TEXT NOT NULL,
    "waMessageId" TEXT,
    "waStatus" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landlord_whatsapp_configs" (
    "id" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "waEnabled" BOOLEAN NOT NULL DEFAULT true,
    "optInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalMessagesSent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "landlord_whatsapp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_boosts" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "boostedFrom" TIMESTAMP(3),
    "boostedUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_boosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renters_passports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "PassportStatus" NOT NULL DEFAULT 'pending',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "incomeVerified" BOOLEAN NOT NULL DEFAULT false,
    "purchasedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renters_passports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_profiles_userId_key" ON "landlord_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_profiles_stripeCustomerId_key" ON "landlord_profiles"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_profiles_stripeSubscriptionId_key" ON "landlord_profiles"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_userId_key" ON "tenant_profiles"("userId");

-- CreateIndex
CREATE INDEX "rooms_status_idx" ON "rooms"("status");

-- CreateIndex
CREATE INDEX "rooms_province_city_idx" ON "rooms"("province", "city");

-- CreateIndex
CREATE INDEX "rooms_rentCents_idx" ON "rooms"("rentCents");

-- CreateIndex
CREATE INDEX "rooms_landlordId_idx" ON "rooms"("landlordId");

-- CreateIndex
CREATE INDEX "applications_tenantId_idx" ON "applications"("tenantId");

-- CreateIndex
CREATE INDEX "applications_roomId_status_idx" ON "applications"("roomId", "status");

-- CreateIndex
CREATE INDEX "applications_roomId_cycle_idx" ON "applications"("roomId", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "applications_roomId_tenantId_cycle_key" ON "applications"("roomId", "tenantId", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_tokens_userId_type_idx" ON "auth_tokens"("userId", "type");

-- CreateIndex
CREATE INDEX "auth_tokens_expiresAt_idx" ON "auth_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_roomId_idx" ON "reports"("roomId");

-- CreateIndex
CREATE INDEX "reports_reportedUserId_idx" ON "reports"("reportedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "tenancies_applicationId_key" ON "tenancies"("applicationId");

-- CreateIndex
CREATE INDEX "tenancies_landlordId_status_idx" ON "tenancies"("landlordId", "status");

-- CreateIndex
CREATE INDEX "tenancies_tenantId_status_idx" ON "tenancies"("tenantId", "status");

-- CreateIndex
CREATE INDEX "tenancies_roomId_idx" ON "tenancies"("roomId");

-- CreateIndex
CREATE INDEX "reviews_roomId_publishedAt_idx" ON "reviews"("roomId", "publishedAt");

-- CreateIndex
CREATE INDEX "reviews_subjectId_publishedAt_idx" ON "reviews"("subjectId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_tenancyId_authorId_type_key" ON "reviews"("tenancyId", "authorId", "type");

-- CreateIndex
CREATE INDEX "saved_rooms_roomId_idx" ON "saved_rooms"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_rooms_tenantId_roomId_key" ON "saved_rooms"("tenantId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "email_logs_providerId_key" ON "email_logs"("providerId");

-- CreateIndex
CREATE INDEX "email_logs_userId_createdAt_idx" ON "email_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "email_logs_toEmail_idx" ON "email_logs"("toEmail");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions"("email");

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchantReference_key" ON "payments"("merchantReference");

-- CreateIndex
CREATE INDEX "payments_userId_status_idx" ON "payments"("userId", "status");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ad_campaigns_status_startsAt_endsAt_idx" ON "ad_campaigns"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ad_campaigns_placement_status_idx" ON "ad_campaigns"("placement", "status");

-- CreateIndex
CREATE INDEX "ad_enquiries_status_createdAt_idx" ON "ad_enquiries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "places_slug_key" ON "places"("slug");

-- CreateIndex
CREATE INDEX "places_type_province_idx" ON "places"("type", "province");

-- CreateIndex
CREATE INDEX "places_city_idx" ON "places"("city");

-- CreateIndex
CREATE INDEX "ux_counters_event_day_idx" ON "ux_counters"("event", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ux_counters_event_segment_day_key" ON "ux_counters"("event", "segment", "day");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE INDEX "referral_codes_type_isActive_idx" ON "referral_codes"("type", "isActive");

-- CreateIndex
CREATE INDEX "referral_codes_city_idx" ON "referral_codes"("city");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_refereeId_key" ON "referrals"("refereeId");

-- CreateIndex
CREATE INDEX "referrals_referrerId_status_idx" ON "referrals"("referrerId", "status");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE INDEX "saved_searches_tenantId_idx" ON "saved_searches"("tenantId");

-- CreateIndex
CREATE INDEX "saved_searches_isActive_province_idx" ON "saved_searches"("isActive", "province");

-- CreateIndex
CREATE INDEX "verification_requests_userId_idx" ON "verification_requests"("userId");

-- CreateIndex
CREATE INDEX "verification_requests_status_idx" ON "verification_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_waMessageId_key" ON "messages"("waMessageId");

-- CreateIndex
CREATE INDEX "messages_applicationId_idx" ON "messages"("applicationId");

-- CreateIndex
CREATE INDEX "messages_waMessageId_idx" ON "messages"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_whatsapp_configs_landlordId_key" ON "landlord_whatsapp_configs"("landlordId");

-- CreateIndex
CREATE UNIQUE INDEX "room_boosts_stripeSessionId_key" ON "room_boosts"("stripeSessionId");

-- CreateIndex
CREATE INDEX "room_boosts_roomId_idx" ON "room_boosts"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "renters_passports_tenantId_key" ON "renters_passports"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "renters_passports_stripeSubscriptionId_key" ON "renters_passports"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replacedById_key" ON "refresh_tokens"("replacedById");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- AddForeignKey
ALTER TABLE "landlord_profiles" ADD CONSTRAINT "landlord_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "tenancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_rooms" ADD CONSTRAINT "saved_rooms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_rooms" ADD CONSTRAINT "saved_rooms_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "referral_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_whatsapp_configs" ADD CONSTRAINT "landlord_whatsapp_configs_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "landlord_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_boosts" ADD CONSTRAINT "room_boosts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renters_passports" ADD CONSTRAINT "renters_passports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

