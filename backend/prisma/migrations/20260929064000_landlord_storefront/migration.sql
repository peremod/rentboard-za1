-- Public landlord storefront — Phase 5b, with 5h's badges computed from it.
--
-- Purely additive: four nullable/defaulted columns on an existing table, one
-- unique index. Nothing is rewritten and no existing row changes meaning.
--
-- `slug` is nullable rather than backfilled. A landlord who has never opened
-- the storefront screen has no public page, and inventing a URL for a person
-- who has not asked for one — then indexing it — is not ours to do.
-- storefrontLive defaults false for the same reason.
ALTER TABLE "landlord_profiles" ADD COLUMN "slug" TEXT;
ALTER TABLE "landlord_profiles" ADD COLUMN "bio" TEXT;
ALTER TABLE "landlord_profiles" ADD COLUMN "logoPath" TEXT;
ALTER TABLE "landlord_profiles" ADD COLUMN "storefrontLive" BOOLEAN NOT NULL DEFAULT false;

-- Unique, because the slug IS the public URL. Postgres allows many NULLs in a
-- unique index, so every landlord without a storefront coexists fine.
CREATE UNIQUE INDEX "landlord_profiles_slug_key" ON "landlord_profiles"("slug");
