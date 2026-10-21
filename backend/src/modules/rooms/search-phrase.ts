/**
 * Turn what somebody typed into the filters this board already has.
 *
 * ── Why this exists
 *
 * `search` was one literal `contains` across title, description and
 * locationDisplay. Measured against the 383 active rooms in development on
 * 20 October:
 *
 *   "Accommodation in Johannesburg"  ->   0 results, while 100 rooms are in
 *                                         Johannesburg
 *   "Johannesburg"                   ->  75 results, missing 25 real
 *                                         Johannesburg rooms whose
 *                                         locationDisplay reads "Soweto"
 *
 * The second number is the more interesting one: `city` was not searched at
 * all, while `suggestLocations()` — the autocomplete that FEEDS this search —
 * already matched on city, province and locationDisplay. Picking a suggestion
 * ran a query that could not see the field the suggestion came from.
 *
 * ── What it does instead
 *
 * It reads the phrase as words rather than as a string, throws away the words
 * that carry no signal on a room-letting board, recognises a place and a room
 * type when they are named, and hands the rest back as tokens.
 *
 * A recognised place becomes the EXISTING `city` or `province` filter, which
 * is exact. That matters more than it looks: once the location half of a query
 * is a real filter rather than a substring guess, the results are correct by
 * construction and nothing has to be ranked back into place afterwards.
 *
 * Pure and dependency-free on purpose — the place list is passed in, so this
 * can be driven over a table of phrases with no database and no Nest context.
 */

/** A place that actually has live listings. Supplied by the caller. */
export interface KnownPlace {
  city: string;
  province: string;
}

export interface ParsedPhrase {
  /** Exact city filter, when the phrase named a city with listings. */
  city?: string;
  /** Exact province filter, when the phrase named one. */
  province?: string;
  /** Room type, when the phrase named one in any of its usual spellings. */
  roomType?: 'shared_house' | 'en_suite' | 'studio' | 'private';
  /**
   * What is left after the above. Every token must match SOMETHING for a room
   * to qualify, so these narrow rather than widen.
   */
  tokens: string[];
  /** True when the phrase carried no usable signal at all (e.g. "in the"). */
  empty: boolean;
}

/**
 * Words that mean nothing on a board where every listing is a room to rent.
 *
 * ⚠️ `room`, `rooms`, `rent`, `accommodation`, `property` and `properties` are
 * in here deliberately. On a general search engine they are the query; here
 * they describe all 383 listings equally, so keeping them would make
 * "rooms to rent in Soweto" match a Pretoria listing whose description happens
 * to say "room to rent" — which is every Pretoria listing.
 *
 * `near` and `me` go too: "shared accommodation near me" is a location
 * intent the browser answers, not a word in any listing.
 */
const FILLER = new Set([
  'a', 'an', 'the', 'in', 'at', 'on', 'to', 'for', 'of', 'and', 'or', 'with',
  'near', 'me', 'my', 'is', 'are', 'available', 'availability', 'from',
  'room', 'rooms', 'rent', 'rental', 'rentals', 'renting', 'let', 'letting',
  'accommodation', 'accomodation', 'property', 'properties', 'place', 'places',
  'looking', 'search', 'find', 'need', 'want', 'cheap',
]);

/**
 * Room-type words, including the spellings people actually type.
 *
 * `bachelor` is South African for a studio and is how most people here would
 * phrase it; leaving it out would mean the single most local term for one of
 * four room types matched nothing.
 */
const ROOM_TYPE_WORDS: ReadonlyArray<[string, ParsedPhrase['roomType']]> = [
  ['studio', 'studio'],
  ['bachelor', 'studio'],
  ['ensuite', 'en_suite'],
  ['en-suite', 'en_suite'],
  ['suite', 'en_suite'],
  ['shared', 'shared_house'],
  ['sharing', 'shared_house'],
  ['housemate', 'shared_house'],
  ['private', 'private'],
  ['backroom', 'private'],
];

/** Lowercase, strip punctuation, collapse whitespace. */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Multi-word places have to be matched before the phrase is split, or
 * "Cape Town" becomes two tokens neither of which is a city. Longest first,
 * so "North West" wins over "North" if both are ever present.
 */
function matchPlace(phrase: string, places: readonly KnownPlace[]) {
  const cities = [...new Set(places.map((p) => p.city))].sort((a, b) => b.length - a.length);
  const provinces = [...new Set(places.map((p) => p.province))].sort((a, b) => b.length - a.length);

  const hit = (name: string) => {
    const n = normalise(name);
    if (!n) return false;
    // Word-boundary match, so "Springs" does not match inside "Springside".
    return new RegExp(`(?:^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(phrase);
  };

  const city = cities.find(hit);
  const province = provinces.find(hit);
  return { city, province };
}

/** Removes a place name's words from the token stream once it has been used. */
function stripPlace(phrase: string, name: string | undefined): string {
  if (!name) return phrase;
  const n = normalise(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return phrase.replace(new RegExp(`(?:^|\\s)${n}(?:\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
}

export function parseSearchPhrase(raw: string, places: readonly KnownPlace[] = []): ParsedPhrase {
  let phrase = normalise(raw ?? '');
  if (!phrase) return { tokens: [], empty: true };

  const { city, province } = matchPlace(phrase, places);
  phrase = stripPlace(stripPlace(phrase, city), province);

  let roomType: ParsedPhrase['roomType'];
  for (const [word, type] of ROOM_TYPE_WORDS) {
    if (new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(phrase)) {
      roomType = type;
      phrase = phrase.replace(new RegExp(`(?:^|\\s)${word}(?:\\s|$)`, 'g'), ' ');
      break;
    }
  }

  const tokens = phrase
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !FILLER.has(t));

  return {
    ...(city && { city }),
    ...(province && { province }),
    ...(roomType && { roomType }),
    tokens,
    empty: !city && !province && !roomType && tokens.length === 0,
  };
}
