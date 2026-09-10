#!/usr/bin/env node
/**
 * Translation and locale audit.
 *
 *   node scripts/i18n-audit.mjs            # report, exit 1 on a hard failure
 *   node scripts/i18n-audit.mjs --strict   # also fail on missing keys
 *
 * What it checks:
 *   1. Every language file parses and is a flat string map
 *   2. Every language file's keys against English (the fallback set)
 *   3. No language file has keys English does not — those are dead weight
 *      that will never render, usually a typo
 *   4. Interpolation placeholders match English, per key
 *   5. The locale list in the backend SEO controller matches the frontend
 *      language model
 *
 * Why 5 matters most: the sitemap's hreflang cluster is generated in the
 * backend from a hard-coded list, and the URLs it advertises are generated in
 * the frontend from a different one. If they drift, the sitemap either
 * advertises a locale that 404s or omits one that exists — and both failures
 * are invisible until Search Console reports them weeks later.
 *
 * Missing keys are a warning by default, not a failure: a language can ship
 * partially translated and fall back to English per key, which is better than
 * blocking a release on a translator. --strict is for the release gate.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const I18N_DIR = join(ROOT, 'frontend/src/assets/i18n');
const LANG_MODEL = join(ROOT, 'frontend/src/app/core/models/language.model.ts');
const SEO_CONTROLLER = join(ROOT, 'backend/src/modules/seo/seo.controller.ts');
const STRICT = process.argv.includes('--strict');

/**
 * Marker key that identifies an English-fallback stub rather than a real
 * translation. Its presence must agree with `translated: false` in
 * language.model.ts — a stub flagged as translated would be published as a
 * locale URL serving English, which is the duplication problem this whole
 * check exists to prevent.
 */
const STUB_MARKER = '_meta_needs_translation';

let failures = 0;
let warnings = 0;
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const warn = (m) => { warnings++; console.log(`  ⚠ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

// ── 1. Load every bundle ──────────────────────────────────────────────────
console.log('\n── Translation bundles ─────────────────────────────────────');

if (!existsSync(I18N_DIR)) {
  fail(`no translations directory at ${I18N_DIR}`);
  process.exit(1);
}

const bundles = {};
for (const file of readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'))) {
  const code = file.replace('.json', '');
  try {
    const parsed = JSON.parse(readFileSync(join(I18N_DIR, file), 'utf8'));
    const bad = Object.entries(parsed).find(([, v]) => typeof v !== 'string');
    if (bad) fail(`${file}: key "${bad[0]}" is not a string — the engine only handles flat string maps`);
    bundles[code] = parsed;
  } catch (e) {
    fail(`${file}: not valid JSON — ${e.message}`);
  }
}

if (!bundles.en) {
  fail('en.json is missing — it is the fallback set, nothing works without it');
  process.exit(1);
}
ok(`${Object.keys(bundles).length} bundles parsed`);

// ── 2 & 3. Key parity against English ─────────────────────────────────────
console.log('\n── Key coverage ────────────────────────────────────────────');

const enKeys = new Set(Object.keys(bundles.en));
const STUBS = new Set(Object.entries(bundles).filter(([, b]) => STUB_MARKER in b).map(([c]) => c));
const placeholders = (s) => (s.match(/{{\s*\w+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort().join(',');

for (const [code, bundle] of Object.entries(bundles)) {
  if (code === 'en') continue;

  const keys = new Set(Object.keys(bundle));
  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));

  // A key English does not have can never be reached by translate(), because
  // lookups are driven by the keys the templates ask for. The stub marker is
  // the one deliberate exception.
  const unexpected = extra.filter((k) => k !== STUB_MARKER);
  if (unexpected.length) {
    fail(`${code}.json has ${unexpected.length} key(s) absent from en.json: ${unexpected.slice(0, 5).join(', ')}`);
  }

  const mismatched = [...keys]
    .filter((k) => enKeys.has(k))
    .filter((k) => placeholders(bundles.en[k]) !== placeholders(bundle[k]));

  // A dropped {{count}} renders a sentence with a hole in it.
  if (mismatched.length) {
    fail(`${code}.json placeholder mismatch on: ${mismatched.slice(0, 5).join(', ')}`);
  }

  if (STUBS.has(code)) {
    ok(`${code} — English-fallback stub, correctly held back from publication`);
    continue;
  }

  const pct = Math.round(((enKeys.size - missing.length) / enKeys.size) * 100);
  if (missing.length === 0) {
    ok(`${code} — complete (${enKeys.size} keys)`);
  } else if (STRICT) {
    fail(`${code} — ${pct}% translated, ${missing.length} key(s) missing`);
  } else {
    warn(`${code} — ${pct}% translated, ${missing.length} key(s) fall back to English`);
  }
}

// ── 4. Frontend and backend locale lists agree ────────────────────────────
console.log('\n── Locale list sync (frontend ↔ backend) ───────────────────');

const modelSrc = readFileSync(LANG_MODEL, 'utf8');
const seoSrc = readFileSync(SEO_CONTROLLER, 'utf8');

/**
 * Parse each language entry with its `translated` flag, so the check compares
 * what the frontend actually publishes — not every language it knows about.
 */
const modelEntries = [...modelSrc.matchAll(/code:\s*'([a-z]{2,3})'[^}]*?translated:\s*(true|false)/g)]
  .map((m) => ({ code: m[1], translated: m[2] === 'true' }));
const modelCodes = modelEntries.map((e) => e.code);
const modelPrefixed = modelEntries.filter((e) => e.translated && e.code !== 'en').map((e) => e.code);

// The flag and the stub marker are two records of the same fact. If they
// disagree, one of them shipped without the other.
for (const entry of modelEntries) {
  const isStub = STUBS.has(entry.code);
  if (entry.translated && isStub) {
    fail(`${entry.code}: marked translated:true but ${entry.code}.json still carries ${STUB_MARKER}`);
  }
  if (!entry.translated && !isStub && entry.code !== 'en') {
    fail(`${entry.code}: ${entry.code}.json looks like a real translation but is still marked translated:false — it will never be published`);
  }
}

const backendMatch = seoSrc.match(/const PREFIXED_LOCALES = \[([^\]]*)\]/);
const backendPrefixed = backendMatch
  ? [...backendMatch[1].matchAll(/'([a-z]{2,3})'/g)].map((m) => m[1])
  : null;

if (!backendPrefixed) {
  fail('could not find PREFIXED_LOCALES in the backend SEO controller');
} else if (modelPrefixed.join(',') !== backendPrefixed.join(',')) {
  fail('locale lists have drifted — the sitemap will advertise URLs that do not exist, or omit ones that do');
  fail(`  frontend: ${modelPrefixed.join(', ')}`);
  fail(`  backend:  ${backendPrefixed.join(', ')}`);
} else {
  ok(`${modelPrefixed.length} published locale(s) — ${modelPrefixed.join(', ')} — identical on both sides`);
  const held = modelEntries.filter((e) => !e.translated).map((e) => e.code);
  if (held.length) ok(`${held.length} held back pending translation: ${held.join(', ')}`);
}

// ── 5. Every declared locale has a bundle, and vice versa ─────────────────
const missingBundles = modelCodes.filter((c) => !bundles[c]);
const orphanBundles = Object.keys(bundles).filter((c) => !modelCodes.includes(c));

if (missingBundles.length) fail(`declared in language.model.ts but no bundle: ${missingBundles.join(', ')}`);
if (orphanBundles.length) warn(`bundle exists but not declared in language.model.ts: ${orphanBundles.join(', ')}`);
if (!missingBundles.length && !orphanBundles.length) ok('every declared language has a bundle');

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
if (failures) {
  console.log(`  ${failures} failure(s), ${warnings} warning(s)`);
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  No i18n problems found${warnings ? ` (${warnings} warning(s))` : ''}.`);
console.log('════════════════════════════════════════════════════════════\n');
