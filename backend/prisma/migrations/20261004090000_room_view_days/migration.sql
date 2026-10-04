-- Phase 7d: how many times a room was looked at, by day.
--
-- `rooms.viewCount` is a single lifetime integer and always has been, which
-- means the dashboard could never answer the question a landlord actually has.
-- "200 views" on a room posted in June says nothing about whether anybody is
-- looking at it NOW, and the UX spec's own example sentence — "Your room has
-- been viewed 47 times this week" — was not implementable against it. The spec
-- had the right sentence and the data to support it did not exist.
--
-- One row per room per day. A day rather than an hour because the figure is
-- read as "this week" and an hourly grain would be fourteen times the rows for
-- precision nobody reads; a counter rather than a row per view because a room
-- on the front page would otherwise write a row per scroll, and nothing here
-- needs to know WHO looked — storing that would be collecting personal data to
-- answer a question that does not need it (POPIA s.10, minimality).
--
-- `viewCount` is kept. It is the lifetime figure, several screens read it, and
-- a rewrite of those to a SUM over this table would be churn for no gain.
CREATE TABLE "room_view_days" (
    "roomId" TEXT NOT NULL,
    -- A calendar date in UTC, matching how every other day-grain figure in this
    -- codebase is keyed (see CalendarService). SAST is UTC+2 with no daylight
    -- saving, so a "day" here runs 02:00–02:00 local. That is a known and
    -- deliberate skew: the alternative is storing a timezone per room.
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_view_days_pkey" PRIMARY KEY ("roomId","day")
);

-- The only read: one room, or one landlord's rooms, over a short window.
CREATE INDEX "room_view_days_day_idx" ON "room_view_days"("day");

ALTER TABLE "room_view_days" ADD CONSTRAINT "room_view_days_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
