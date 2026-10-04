-- Inviting an applicant to come and see the room — Phase 7l.
--
-- ── There was no such thing before this
--
-- ApplicationStatus runs pending → viewed → shortlisted → accepted, and
-- `viewed` means THE LANDLORD OPENED THE APPLICATION — not that anybody saw the
-- room. Nothing in the product recorded a viewing, so "I'll meet you Saturday
-- at four" lived in the message thread and nowhere else: no date either side
-- could look up, nothing the tenant could answer yes or no to, and nothing to
-- say whether it had been agreed at all.
--
-- ── Hung off the application
--
-- An application already ties one tenant to one room and carries the letting
-- cycle, and both sides already have a screen for it. Separate room and tenant
-- columns would allow a viewing for somebody who never applied — which is a
-- stranger being handed a residential address.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  THE MEETING PLACE IS TYPED, NEVER PRE-FILLED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The board shows a suburb and not a street: Room.locationDisplay is "Tembisa,
-- Johannesburg" deliberately, for the tenant's safety and the landlord's.
--
-- Property.addressLine does hold a street address — and the form where a
-- landlord types it says, in these words: "Only you see this. It is never on a
-- listing and never sent to an applicant."
--
-- So this column cannot be pre-filled from it. Doing so would break a promise
-- the product made in writing, on the form where the landlord typed it, and the
-- landlord would never know it had happened. The landlord types where to meet,
-- for this viewing, for this person, and the invitation screen says it will be
-- sent to them.
--
-- This is the one moment an address is deliberately disclosed, to one named
-- applicant, chosen deliberately. That is what makes it defensible, and it is
-- why there is no convenience here.

CREATE TYPE "ViewingStatus" AS ENUM ('proposed', 'accepted', 'declined', 'cancelled');

CREATE TABLE "room_viewings" (
  "id"            TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "startsAt"      TIMESTAMP(3) NOT NULL,
  "meetingPlace"  TEXT NOT NULL,
  "note"          TEXT,
  "status"        "ViewingStatus" NOT NULL DEFAULT 'proposed',
  "respondedAt"   TIMESTAMP(3),
  "declineReason" TEXT,
  "cancelledAt"   TIMESTAMP(3),
  "cancelledById" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "room_viewings_pkey" PRIMARY KEY ("id")
);

-- An invitation with nowhere to go is not an invitation. Guarded here as well
-- as in the DTO, because the rule matters more than the route: a seed script or
-- a second surface must not be able to send somebody a time and no place.
ALTER TABLE "room_viewings"
  ADD CONSTRAINT "room_viewings_meeting_place_not_blank"
  CHECK (length(btrim("meetingPlace")) >= 3);

-- An answered viewing has a date on the answer, and an unanswered one does not.
-- Both halves: a `respondedAt` with status still `proposed` would mean somebody
-- answered and we lost which way, and an `accepted` with no date is a claim
-- with no time behind it — the same reasoning as the dated contractor checks.
ALTER TABLE "room_viewings"
  ADD CONSTRAINT "room_viewings_answer_has_a_date"
  CHECK (
    ("status" IN ('accepted', 'declined') AND "respondedAt" IS NOT NULL)
    OR ("status" IN ('proposed', 'cancelled') AND "respondedAt" IS NULL)
  );

-- Likewise a cancellation.
ALTER TABLE "room_viewings"
  ADD CONSTRAINT "room_viewings_cancellation_has_a_date"
  CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL));

CREATE INDEX "room_viewings_applicationId_startsAt_idx"
  ON "room_viewings"("applicationId", "startsAt");
CREATE INDEX "room_viewings_startsAt_status_idx"
  ON "room_viewings"("startsAt", "status");

ALTER TABLE "room_viewings"
  ADD CONSTRAINT "room_viewings_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL rather than CASCADE: if the person who cancelled closes their
-- account their tombstone survives anyway, and losing WHO cancelled is better
-- than losing the fact that it was cancelled.
ALTER TABLE "room_viewings"
  ADD CONSTRAINT "room_viewings_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
