-- Rename the MessageChannel value 'rentboard' -> 'in_app'.
--
-- The value named the brand, so renaming the product reached into the database
-- schema. 'in_app' describes what the value actually means — a message sent
-- through the site rather than arriving over WhatsApp — and stays correct
-- whatever the product is called next.
--
-- ALTER TYPE ... RENAME VALUE rewrites the label in place. Existing rows keep
-- pointing at the same enum member, so no data is rewritten and no row changes
-- meaning. It is not reversible inside a transaction on older PostgreSQL, but
-- the reverse is a one-line migration of the same shape.
ALTER TYPE "MessageChannel" RENAME VALUE 'rentboard' TO 'in_app';

-- The column default still names the old label after the rename on some
-- versions, so it is restated explicitly.
ALTER TABLE "messages" ALTER COLUMN "channel" SET DEFAULT 'in_app';
