-- Rename, deliberately hand-written.
--
-- `prisma migrate dev` generates DROP COLUMN + ADD COLUMN for a rename, which
-- would discard the timestamp on every request ever decided. RENAME COLUMN
-- keeps the data and the column's type, and Postgres carries the rename to any
-- index or constraint referencing it (there are none on this column).
--
-- Why rename at all: the old name asserted something that was not happening.
-- Nothing in this codebase ever deleted a file from ImageKit, so
-- `documentDeletedAt` recorded the moment a document stopped being REACHABLE,
-- not the moment it ceased to exist. The real deletion is now tracked on
-- file_deletions.deletedAt, set from ImageKit's own response.
ALTER TABLE "verification_requests"
  RENAME COLUMN "documentDeletedAt" TO "documentWithdrawnAt";
