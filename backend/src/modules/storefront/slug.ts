/**
 * Turning a person's name into a URL segment.
 *
 * Kept as a pure function in its own file so it can be reasoned about and
 * tested without a database: slug rules are the kind of thing that look obvious
 * and then mangle somebody's actual name.
 *
 * ── South African names specifically
 *
 * This market's names carry diacritics (Zoë, José), apostrophes (O'Brien),
 * hyphens (Van der Merwe-Botha) and isiXhosa/isiZulu click consonants that are
 * plain ASCII already. Diacritics are decomposed and stripped rather than
 * dropped, so Zoë becomes `zoe` and not `zo`. Anything outside a-z0-9 becomes a
 * single hyphen.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      // Strip combining marks left behind by the decomposition, which is what
      // turns "ë" into "e" rather than into nothing.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // An apostrophe joins rather than separates: O'Brien is one word to a
      // reader, so `obrien` reads better than `o-brien`.
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // A cap, because the slug ends up in a URL, a sitemap entry and whatever
      // people paste into WhatsApp.
      .slice(0, 60)
      .replace(/-+$/g, '')
  );
}

/**
 * Words that cannot be a slug, because the URL would mean something else.
 *
 * The storefront lives at /landlords/:slug, so anything the router or a crawler
 * treats specially has to be excluded — and so does anything that would let a
 * landlord's page impersonate a part of the site.
 */
const RESERVED = new Set([
  'new', 'edit', 'admin', 'api', 'me', 'settings', 'login', 'logout', 'signup',
  'register', 'search', 'all', 'verified', 'sitemap', 'robots', 'assets',
  'static', 'null', 'undefined', 'index', 'about', 'help', 'support', 'legal',
  'privacy', 'terms', 'mastande', 'rentboard',
]);

/**
 * A slug nobody else has, given what is already taken.
 *
 * Collisions are resolved by appending -2, -3 … rather than a random suffix or a
 * uuid fragment. Two landlords called Thabo Mokoena should get
 * `thabo-mokoena` and `thabo-mokoena-2`, because the second one is still a URL a
 * human can read and say out loud — which is the entire reason for not using the
 * id in the first place.
 *
 * `taken` is passed in rather than queried here so this stays pure; the caller
 * owns the database round trip.
 */
export function uniqueSlug(
  name: string,
  taken: ReadonlySet<string>,
  fallback = 'landlord',
): string {
  let base = slugify(name);
  // An empty or reserved base still needs a usable URL — a name written entirely
  // in a script this strips would otherwise produce "".
  if (!base || RESERVED.has(base)) base = fallback;

  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // A thousand identical names is not a real case, but returning something
  // colliding would be worse than a long slug.
  return `${base}-${Date.now().toString(36)}`;
}

/** Whether a slug could ever have been issued by uniqueSlug. Cheap 404 guard. */
export function isPlausibleSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
}
