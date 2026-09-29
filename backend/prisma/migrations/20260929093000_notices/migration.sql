-- In-app notices — Phase 7g's notification fallback.
--
-- Email stopped being required in the same release, which created a way to lose
-- somebody's applications silently: every notification was
-- sendSomethingEmail(user.email, …), and for an account with no address that is
-- a send to nowhere.
--
-- WhatsApp alone does not fix it. Every outbound message here is free-form text,
-- which Meta permits only inside the 24-hour customer service window; outside it
-- a business-initiated message is rejected with 131047 unless an approved
-- template exists, and none is approved yet. A fallback that fails whenever the
-- person has not messaged recently is not a fallback.
--
-- whatsappSentAt is set only from a successful send, and whatsappError holds the
-- reason otherwise. Same rule as file_deletions: a delivery nobody confirmed is
-- not a delivery.
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "whatsappSentAt" TIMESTAMP(3),
    "whatsappError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- The unread list, newest first.
CREATE INDEX "notices_userId_readAt_createdAt_idx" ON "notices"("userId", "readAt", "createdAt");

ALTER TABLE "notices" ADD CONSTRAINT "notices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
