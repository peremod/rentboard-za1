-- Contractor leads, and what they would cost — Phase 7k.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  NOTHING HERE COLLECTS MONEY, AND THAT IS NOT AN OVERSIGHT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A contractor is not a user. service_providers has no userId and no email — a
-- name, a phone number and the areas they cover. They cannot sign in, cannot
-- see a bill, cannot accept terms and cannot dispute a charge inside this
-- product.
--
-- So this migration builds the RECORD: what we sent, to whom, on what day, and
-- what it comes to at a rate somebody agreed. Invoicing and collection happen
-- outside the product, by a person, from this record. Making the product
-- collect would need contractor accounts first — a portal, terms acceptance, a
-- bill they can read and a way to disagree with it — which is a product, not a
-- column, and a decision for the owner rather than a migration.
--
-- Note this does NOT touch "free to list, free to apply": the money would come
-- from a contractor receiving leads, a third party, never from a landlord
-- listing a room or a tenant applying for one.
--
-- ── There is no price in this migration, or anywhere in the code
--
-- The brief said: do not implement arbitrary pricing assumptions, identify
-- where pricing should be configurable. contractor_lead_rates is that answer.
-- It ships EMPTY. No default, no fallback, no env var holding a number. Until
-- somebody inserts a rate, leads are recorded with feeCents NULL and
-- billable = false: the product counts what it sent and declines to put a
-- figure on it, which is the honest state of a price nobody has decided.
--
-- ── Rates are effective-dated and never edited
--
-- A new row supersedes an older one and the old one stays, because leads point
-- at the rate they were created under. Changing the price next month must not
-- re-price what was already sent.
--
-- ── Deduplicated per landlord per day
--
-- A landlord tapping "call" five times while the phone rings is one lead. The
-- unique index is (providerId, landlordId, leadDay). leadDay is its own column
-- because Prisma cannot express an index over an expression like
-- date_trunc('day', "createdAt").
--
-- ⚠️ NULLs in that index do not collide in Postgres, so once a landlord closes
-- their account their leads stop deduplicating against each other. That is
-- correct and worth stating: they are historical rows nobody will add to, and
-- the alternative — keeping the landlord id to preserve a dedupe nobody needs —
-- would mean retaining personal information for the convenience of an index.
--
-- ── Why the landlord's identity is here at all
--
-- room_view_days stores a count and no viewer identity, deliberately, because a
-- count was all anybody needed (POPIA s.10, minimality). Here identity is
-- load-bearing twice: deduplication needs same-landlord-or-different, and a
-- contractor disputing "you billed me for twelve leads" can only be answered
-- from rows that tell twelve landlords apart from one landlord twelve times.
--
-- It is never disclosed to the contractor, who has no account to see it in, and
-- it is NULLED when the landlord closes their account — the lead is a record
-- involving a third party and stays; the person does not.

CREATE TYPE "ContractorLeadChannel" AS ENUM ('call', 'whatsapp');

-- A contractor agrees to lead fees out of band, because they have no account in
-- which to agree. Nothing is billable without this.
ALTER TABLE "service_providers"
  ADD COLUMN "leadFeesAgreedAt" TIMESTAMP(3),
  ADD COLUMN "leadFeesNote"     TEXT;

CREATE TABLE "contractor_lead_rates" (
  "id"            TEXT NOT NULL,
  "category"      "ServiceCategory" NOT NULL,
  "amountCents"   INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "note"          TEXT,
  "setByAdminId"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contractor_lead_rates_pkey" PRIMARY KEY ("id")
);

-- A negative or zero lead fee is not a price, it is a mistake. Guarded here as
-- well as in the DTO, because the rule matters more than the route.
ALTER TABLE "contractor_lead_rates"
  ADD CONSTRAINT "contractor_lead_rates_amount_positive" CHECK ("amountCents" > 0);

CREATE INDEX "contractor_lead_rates_category_effectiveFrom_idx"
  ON "contractor_lead_rates"("category", "effectiveFrom");

CREATE TABLE "contractor_leads" (
  "id"         TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "landlordId" TEXT,
  "channel"    "ContractorLeadChannel" NOT NULL,
  "leadDay"    DATE NOT NULL,
  "feeCents"   INTEGER,
  "rateId"     TEXT,
  "billable"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contractor_leads_pkey" PRIMARY KEY ("id")
);

-- A lead cannot be billable without a figure on it. The two are set together or
-- not at all, and this stops a future code path marking something billable with
-- nothing to bill.
ALTER TABLE "contractor_leads"
  ADD CONSTRAINT "contractor_leads_billable_needs_fee"
  CHECK ("billable" = false OR "feeCents" IS NOT NULL);

CREATE UNIQUE INDEX "contractor_leads_providerId_landlordId_leadDay_key"
  ON "contractor_leads"("providerId", "landlordId", "leadDay");
CREATE INDEX "contractor_leads_providerId_createdAt_idx"
  ON "contractor_leads"("providerId", "createdAt");
CREATE INDEX "contractor_leads_billable_createdAt_idx"
  ON "contractor_leads"("billable", "createdAt");

ALTER TABLE "contractor_leads"
  ADD CONSTRAINT "contractor_leads_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contractor_leads"
  ADD CONSTRAINT "contractor_leads_landlordId_fkey"
  FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contractor_leads"
  ADD CONSTRAINT "contractor_leads_rateId_fkey"
  FOREIGN KEY ("rateId") REFERENCES "contractor_lead_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
