-- Lease document storage — Phase 4e.
--
-- Storage only. There is no signature column here and there is not going to be
-- one without ECT Act advice behind it: signing is execution of a legal
-- document, and a half-built e-signature is worse than none because it looks
-- like one.
CREATE TYPE "LeaseDocumentKind" AS ENUM ('lease', 'addendum', 'inspection', 'deposit_receipt', 'other');

CREATE TABLE "lease_documents" (
    "id" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" "LeaseDocumentKind" NOT NULL DEFAULT 'lease',
    "path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentType" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lease_documents_tenancyId_createdAt_idx" ON "lease_documents"("tenancyId", "createdAt");

-- Cascade on the tenancy: paperwork for a tenancy that no longer exists has
-- nothing to hang off. uploadedById is deliberately NOT a foreign key — an
-- account being deleted must not take the other party's copy of the agreement.
ALTER TABLE "lease_documents" ADD CONSTRAINT "lease_documents_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "tenancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
