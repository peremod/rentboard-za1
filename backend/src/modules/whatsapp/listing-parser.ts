import { RoomType } from '@prisma/client';

/**
 * Turns a landlord's WhatsApp message into the beginnings of a listing.
 *
 * **Deliberately simple, and deliberately not an LLM.** Three reasons, in
 * order of weight:
 *
 *   1. A landlord reviews and publishes every draft on the web before anyone
 *      sees it, so the parser being wrong costs a correction, not a bad
 *      listing. That makes cleverness worth very little here.
 *   2. Sending South African landlords' messages to a third-party model means
 *      personal information leaving the country under POPIA s.72, and
 *      `/advertise` sells this platform on "no third-party trackers, no data
 *      leaves the platform". Quietly breaking that for a convenience feature
 *      is a bad trade.
 *   3. Regex and a lookup work identically in every one of the eleven
 *      official languages for the parts that matter — a rand amount is a rand
 *      amount, and a suburb name is a suburb name. A model would be markedly
 *      worse at isiZulu and Sesotho than at English, which would mean the
 *      feature working best for the landlords who need it least.
 *
 * Anything it cannot work out comes back null and shows as a blank on the
 * review screen. A blank is honest; a guess presented as a fact is not.
 */

export interface ParsedListing {
  title: string | null;
  rentCents: number | null;
  roomType: RoomType | null;
  /** Matched against the Place taxonomy by the caller, which owns the data. */
  locationHint: string | null;
}

/**
 * Rent.
 *
 * Handles `R3500`, `R3 500`, `R3,500`, `3500 a month`, `3.5k`. Takes the
 * FIRST plausible amount rather than the largest: a landlord writing "R3500,
 * deposit R7000" means the rent is 3500, and picking the biggest number would
 * reliably choose the deposit.
 *
 * Bounded to R300–R50,000. Below that it is almost certainly a house number
 * or a room count; above it, this is not a room.
 */
export function parseRent(text: string): number | null {
  const candidates: number[] = [];

  // "3.5k" / "3,5k" — common shorthand.
  for (const m of text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*k\b/gi)) {
    candidates.push(Math.round(parseFloat(m[1].replace(',', '.')) * 1000));
  }
  // "R3 500", "R3,500", "R3500", or a bare number near a rent word.
  for (const m of text.matchAll(/R\s?(\d[\d\s,.]{2,})/gi)) {
    const n = parseInt(m[1].replace(/[\s,.]/g, ''), 10);
    if (!Number.isNaN(n)) candidates.push(n);
  }
  for (const m of text.matchAll(/\b(\d[\d\s,]{2,})\s*(?:per month|a month|pm|p\/m|monthly)\b/gi)) {
    const n = parseInt(m[1].replace(/[\s,]/g, ''), 10);
    if (!Number.isNaN(n)) candidates.push(n);
  }

  const rent = candidates.find((n) => n >= 300 && n <= 50000);
  return rent ? rent * 100 : null;
}

/**
 * Room type.
 *
 * Keyword sets rather than a single word each, because the same room is
 * called different things: "outside room" and "backroom" are the same thing
 * to most people here, and neither appears in the enum.
 */
const ROOM_TYPE_WORDS: { type: RoomType; words: string[] }[] = [
  { type: 'en_suite', words: ['en suite', 'ensuite', 'en-suite', 'own bathroom', 'private bathroom', 'with bathroom'] },
  { type: 'studio', words: ['studio', 'bachelor', 'bachelors', 'garden flat', 'granny flat'] },
  { type: 'shared_house', words: ['shared', 'share', 'sharing', 'commune', 'housemate', 'housemates'] },
  { type: 'private', words: ['private room', 'own room', 'single room', 'outside room', 'backroom', 'back room'] },
];

export function parseRoomType(text: string): RoomType | null {
  const lower = ` ${text.toLowerCase()} `;
  // Most specific first: "en suite" also contains no other keyword, but
  // "private room with own bathroom" should be en_suite, not private.
  for (const { type, words } of ROOM_TYPE_WORDS) {
    if (words.some((w) => lower.includes(w))) return type;
  }
  return null;
}

/**
 * A title, when the landlord did not obviously write one.
 *
 * Built from what was understood rather than lifted from the message: the
 * first line of a WhatsApp message is as likely to be "Hi" as anything
 * useful. Kept above the 10-character minimum the room DTO enforces.
 */
export function buildTitle(parsed: Omit<ParsedListing, 'title'>, suburb?: string | null): string | null {
  const type = parsed.roomType;
  const typeWord =
    type === 'en_suite' ? 'En-suite room'
    : type === 'studio' ? 'Studio'
    : type === 'shared_house' ? 'Room in a shared house'
    : type === 'private' ? 'Private room'
    : null;

  if (!typeWord && !suburb) return null;
  if (typeWord && suburb) return `${typeWord} in ${suburb}`;
  return typeWord ?? `Room in ${suburb}`;
}

/**
 * The words most likely to name a place, for the caller to match against the
 * Place taxonomy.
 *
 * Returns the whole message lowercased rather than trying to find the place
 * itself — the taxonomy has 112 entries with aliases and is the only thing
 * that actually knows what a South African suburb is called. Splitting that
 * knowledge between here and there is how the two drift apart.
 */
export function locationCandidates(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

export function parseListing(text: string): ParsedListing {
  const roomType = parseRoomType(text);
  return {
    title: null, // filled by the caller once the location is resolved
    rentCents: parseRent(text),
    roomType,
    locationHint: null,
  };
}
