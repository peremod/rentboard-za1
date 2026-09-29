-- The retention queue.
--
-- Nothing in this codebase had ever deleted a stored file. Deciding a
-- verification cleared documentPath, stamped documentDeletedAt and wrote an
-- audit event saying the document was deleted; there was no ImageKit SDK and no
-- delete call anywhere. The reference went, the file stayed.
--
-- A row here is written in the same transaction as the change that orphans a
-- file, and deletedAt is set only from the storage provider's own response.
CREATE TABLE "file_deletions" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "verificationRequestId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deletedAt" TIMESTAMP(3),
    "alreadyGone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_deletions_pkey" PRIMARY KEY ("id")
);

-- The queue's working order: outstanding rows oldest first.
CREATE INDEX "file_deletions_deletedAt_createdAt_idx" ON "file_deletions"("deletedAt", "createdAt");
