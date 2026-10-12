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
 * ⚠️ This cannot be checked in a browser in this container. Measured on 11
 * October: `"DM Mono"`, `"Playfair Display"` and two deliberately bogus
 * family names all render at **identical width** here, because
 * fonts.googleapis.com is unreachable through the agent proxy and every
 * webfont falls back. So a rendered check would report every family as
 * missing, including the ones that work in production. This is therefore a
 * STATIC check against the markup, which is where the truth is.
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
/** Families the page actually asks for, with the weights requested. */
const requested = new Map();
for (const m of index.matchAll(/family=([^&"']+)/g)) {
  const [fam, weights] = m[1].split(':');
  const name = decodeURIComponent(fam).replace(/\+/g, ' ').toLowerCase();
  const ws = [...(weights ?? '').matchAll(/\d{3}/g)].map((w) => Number(w[0]));
  requested.set(name, [...(requested.get(name) ?? []), ...ws]);
}
if (requested.size === 0) {
  console.error(`No font request found in ${INDEX}. Refusing to pass vacuously.`);
  process.exit(2);
}
ok(`${requested.size} family(ies) requested: ${[...requested.keys()].join(', ')}`);

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
const displayWeights = new Set(displayFamilies.flatMap((fam) => requested.get(fam)));

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
  const missing = [...usedWeights].filter((w) => !displayWeights.has(w));
  missing.length === 0
    ? ok(`display weights used (${[...usedWeights].sort().join(', ')}) are all requested (${[...displayWeights].sort().join(', ')})`)
    : bad(`display weight(s) ${missing.join(', ')} are used but NOT requested — the browser synthesises them`);
}

console.log('════════════════════════════════════════════════════════════');
if (fail) {
  console.log(`  ${fail} problem(s). A token that names a font nothing fetches is a lie the`);
  console.log('  design handoff then repeats as fact.\n');
  process.exit(1);
}
console.log('  ✅ every font token names something that actually arrives.\n');
