#!/usr/bin/env node
/**
 * A font token may not name a family nothing fetches.
 *
 * ── Why this exists
 *
 * `--font-mono` named `'DM Mono'` first. `index.html` has never requested it:
 * the Google Fonts link asks for Playfair Display 700/900 and DM Sans
 * 400/500/600/700, and nothing else. So every money figure in this app — the
 * room price, the hero stat, the rent ledger, the archive's month amounts —
 * has rendered in Courier New or the platform monospace since the token was
 * written, while the design system said DM Mono and the design handoff
 * reported it as one of "three real faces".
 *
 * Nothing could see it. The token resolves, so `token-lint` is satisfied. The
 * production build does not fetch fonts. `getComputedStyle().fontFamily`
 * echoes the DECLARATION back, so a drive reading it "confirms" a font that is
 * not there — which is exactly what `logo-drive` does, and it is why that
 * drive's font assertion is deliberately about the weight and size, not the
 * family.
 *
 * ⚠️ This USED not to be checkable in a browser in this container. Measured on
 * 11 October: `"DM Mono"`, `"Playfair Display"` and two deliberately bogus
 * family names all rendered at **identical width** here, because
 * fonts.googleapis.com is unreachable through the agent proxy and every
 * webfont fell back — so a rendered check would have reported every family as
 * missing, including the ones that worked in production.
 *
 * Self-hosting (25 October) changed that: the faces come from this origin, so
 * they load in a headless browser here like anywhere else. Measured the day it
 * landed, against a deliberately bogus family at the same size:
 *
 *     Playfair Display  300.23px   vs bogus 282.39px   -> the real face
 *     DM Sans           312.20px   vs bogus 309.34px   -> the real face
 *
 * This file stays a STATIC check anyway, because it answers a different
 * question — whether a token names something the app SERVES — and a static
 * answer cannot be wrong about a build it did not run. The rendered proof
 * belongs in a drive.
 *
 * What it does:
 *
 *   1. Every family named in a `--font-*` token is either requested in
 *      index.html, or is a generic / system family that needs no request.
 *   2. Every weight used with `--font-display` is in the requested range —
 *      a 900 that was never fetched is synthesised, and a synthesised heavy
 *      serif is the difference between the wordmark and a smeared one.
 *
 *   node scripts/font-lint.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cssSource, stripComments } from './lib/css-values.mjs';

const INDEX = 'frontend/src/index.html';
const STYLES = 'frontend/src/styles';
const APP = 'frontend/src/app';

/** Families that need no webfont request. */
const SYSTEM = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-monospace', 'ui-serif', 'ui-sans-serif',
  'georgia', 'menlo', 'consolas', 'courier new', 'courier', 'arial',
  'helvetica', 'helvetica neue', 'times new roman', 'roboto', 'roboto mono',
  'segoe ui', '-apple-system', 'blinkmacsystemfont',
]);

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

console.log('\n── Fonts: named vs fetched ─────────────────────────────────');

const index = readFileSync(INDEX, 'utf8');

/**
 * Families the app actually serves, with the weight range each covers.
 *
 * ⚠️ Rewritten on 25 October 2026, when the two families moved from Google
 * Fonts to src/assets/fonts. This used to parse `family=` out of the
 * googleapis URL in index.html — and the moment that URL went, it correctly
 * refused to run rather than passing on an empty set, which is the only reason
 * this rewrite happened instead of a silent green.
 *
 * The source of truth is now the @font-face blocks, and the check is stronger
 * for it: a Google URL could only ever prove what was ASKED for, while a local
 * `src:` can be checked against a file that is either there or is not.
 */
const faces = [];
for (const f of walk(STYLES).filter((p) => p.endsWith('.scss'))) {
  const css = stripComments(readFileSync(f, 'utf8'));
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const fam = /font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/.exec(body)?.[1]?.trim().toLowerCase();
    const src = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(body)?.[1];
    const weights = [...(/font-weight\s*:\s*([^;]+);/.exec(body)?.[1] ?? '').matchAll(/\d{2,4}/g)]
      .map((w) => Number(w[0]));
    const display = /font-display\s*:\s*([\w-]+)/.exec(body)?.[1];
    if (fam && src) faces.push({ fam, src, weights, display, file: f });
  }
}
if (faces.length === 0) {
  console.error(`No @font-face found under ${STYLES}. Refusing to pass vacuously.`);
  process.exit(2);
}

/** family -> [minWeight, maxWeight] across its faces. */
const requested = new Map();
for (const face of faces) {
  const prev = requested.get(face.fam) ?? [];
  requested.set(face.fam, [...prev, ...face.weights]);
}
ok(`${requested.size} family(ies) served from this origin: ${[...requested.keys()].join(', ')}`);

// ── 0. Every face points at a file that exists ───────────────────────────
//
// The failure self-hosting introduces, and the one a URL could never have:
// a renamed or uncopied file leaves a face that resolves to nothing, and the
// page falls back silently in exactly the way the webfont was meant to stop.
for (const face of faces) {
  const onDisk = join('frontend/src', face.src.replace(/^\//, ''));
  try {
    statSync(onDisk);
    ok(`${face.fam} ${face.src.split('/').pop()} is on disk (${(statSync(onDisk).size / 1024).toFixed(0)} KB)`);
  } catch {
    bad(`${face.fam} names ${face.src}, and ${onDisk} does not exist — that face renders nothing`);
  }
}

// ── 0b. Nothing fetches a font from a third party any more ───────────────
//
// Not style: a third-party font request is two DNS lookups and two TLS
// handshakes on the critical path, and it was also where the reflow came from.
// If one creeps back in, the preloads below it are no longer the whole story.
// ⚠️ Comments stripped first. The first version of this check read the whole
// file and failed on the COMMENT that explains why the Google origin is gone —
// a check that cannot tell markup from prose about markup.
const markup = index.replace(/<!--[\s\S]*?-->/g, '');
if (/fonts\.(googleapis|gstatic)\.com/.test(markup)) {
  bad('index.html still fetches from a Google Fonts origin — the faces are self-hosted now');
} else {
  ok('no third-party font origin is fetched by index.html');
}

// ── 0c. The preload matches a face that exists ───────────────────────────
const preloaded = [...index.matchAll(/<link[^>]+rel="preload"[^>]+href="([^"]+\.woff2)"/g)].map((m) => m[1]);
for (const href of preloaded) {
  const matching = faces.find((f) => f.src === href);
  if (!matching) {
    bad(`index.html preloads ${href}, which no @font-face uses — the browser fetches it and throws it away`);
  } else if (!/crossorigin/.test(index.slice(Math.max(0, index.indexOf(href) - 200), index.indexOf(href)))) {
    bad(`the preload of ${href} has no crossorigin attribute — a font is a CORS request, so it would be fetched twice`);
  } else {
    ok(`preload of ${href.split('/').pop()} matches a declared face`);
  }
}
if (preloaded.length === 0) {
  console.log('  ⚠️  nothing is preloaded — the faces still work, they just arrive later');
}

// ── 1. Every family in a token is fetched or is a system family ──────────
const tokens = new Map();
for (const f of walk(STYLES).filter((p) => p.endsWith('.scss'))) {
  const css = stripComments(readFileSync(f, 'utf8'));
  for (const m of css.matchAll(/(--font-[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
}
if (tokens.size === 0) {
  console.error('No --font-* tokens found. Refusing to pass vacuously.');
  process.exit(2);
}

for (const [name, value] of tokens) {
  const families = value.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  const unfetched = families.filter((fam) => !SYSTEM.has(fam) && !requested.has(fam));
  if (unfetched.length) {
    bad(`${name} names ${unfetched.map((u) => `"${u}"`).join(', ')} — nothing requests it, so it never renders`);
  } else {
    ok(`${name}: every family is fetched or is a system family`);
  }
}

// ── 2. Weights used with the display face are in the requested range ─────
const displayFamilies = (tokens.get('--font-display') ?? '')
  .split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
  .filter((fam) => requested.has(fam));
/**
 * ⚠️ A range, not a list.
 *
 * `font-weight: 400 900` on a variable face covers every weight BETWEEN those
 * two. The first version of this check collected the numbers as discrete
 * values and then reported that 700 "is used but NOT requested" — about a
 * variable font that renders 700 natively. A check that reads a range as a set
 * is wrong in the direction that costs you a real weight.
 */
const declared = displayFamilies.flatMap((fam) => requested.get(fam) ?? []);
const range = declared.length ? [Math.min(...declared), Math.max(...declared)] : null;
const covers = (w) => range !== null && w >= range[0] && w <= range[1];

const usedWeights = new Set();
for (const f of [...walk(APP), ...walk(STYLES)]) {
  if (!/\.(ts|scss)$/.test(f) || f.endsWith('.spec.ts')) continue;
  const src = readFileSync(f, 'utf8');
  const s = cssSource(f, src);
  if (!s) continue;
  // A rule that sets the display family and a weight in the same block.
  for (const m of s.css.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1];
    if (!/font-family\s*:\s*var\(--font-display\)/.test(body)) continue;
    for (const w of body.matchAll(/font-weight\s*:\s*(\d{3})/g)) usedWeights.add(Number(w[1]));
  }
}

if (usedWeights.size === 0) {
  console.log('  ⚠️  no rule sets --font-display and a numeric weight in the same block — nothing to check');
} else {
  const missing = [...usedWeights].filter((w) => !covers(w));
  missing.length === 0
    ? ok(`display weights used (${[...usedWeights].sort((a, b) => a - b).join(', ')}) are all inside the face's range (${range?.join('–')})`)
    : bad(`display weight(s) ${missing.join(', ')} fall outside the face's range (${range?.join('–')}) — the browser synthesises them`);
}

console.log('════════════════════════════════════════════════════════════');
if (fail) {
  console.log(`  ${fail} problem(s). A token that names a font nothing fetches is a lie the`);
  console.log('  design handoff then repeats as fact.\n');
  process.exit(1);
}
console.log('  ✅ every font token names something that actually arrives.\n');
