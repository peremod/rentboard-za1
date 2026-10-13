#!/usr/bin/env node
/**
 * Environment parity audit.
 *
 *   node scripts/env-parity.mjs
 *
 * Angular swaps environment files at build time via `fileReplacements`, so
 * each configuration compiles exactly one of them. TypeScript therefore never
 * compares them: a key present in environment.prod.ts and absent from
 * environment.staging.ts produces no error anywhere. It produces
 * `undefined` at runtime, on staging only, usually in whatever code path
 * happens to be least exercised.
 *
 * This is the check that catches it, plus the backend equivalent: every
 * variable the code reads from config must be documented in .env.example, or
 * a deploy target will silently miss it.
 *
 * Checks:
 *   1. All three frontend environment files export the same key set
 *   2. `production` and `indexable` hold the values each environment requires
 *   3. No two environments share an apiUrl or siteUrl (a copy-paste slip that
 *      points staging at the production database is not hypothetical)
 *   4. Every process.env / config.get key used in the backend appears in
 *      backend/.env.example, and also in docs/DEPLOYMENT.md — a complete
 *      .env.example does not help anyone provisioning from the guide
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import yaml from 'js-yaml';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const ENV_DIR = join(ROOT, 'frontend/src/environments');
const BE_SRC = join(ROOT, 'backend/src');
const ENV_EXAMPLE = join(ROOT, 'backend/.env.example');

let failures = 0;
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const warn = (m) => console.log(`  ⚠ ${m}`);
const ok = (m) => console.log(`  ✓ ${m}`);

// ── 1. Frontend environment files ─────────────────────────────────────────
console.log('\n── Frontend environment parity ─────────────────────────────');

const FILES = {
  development: 'environment.ts',
  staging: 'environment.staging.ts',
  production: 'environment.prod.ts',
};

const parsed = {};
for (const [name, file] of Object.entries(FILES)) {
  const path = join(ENV_DIR, file);
  if (!existsSync(path)) {
    fail(`${file} is missing`);
    continue;
  }
  const src = readFileSync(path, 'utf8');

  // Deliberately a regex rather than an import: this script runs before any
  // build step, with no TypeScript toolchain guaranteed to be present.
  const body = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
  const entries = {};
  for (const m of body.matchAll(/^\s*(\w+)\s*:\s*(.+?),?\s*$/gm)) {
    const value = m[2].replace(/,$/, '').trim();
    if (value.startsWith('//')) continue;
    entries[m[1]] = value.replace(/^['"]|['"]$/g, '');
  }
  parsed[name] = entries;
}

const keySets = Object.entries(parsed).map(([name, e]) => [name, new Set(Object.keys(e))]);
const union = new Set(keySets.flatMap(([, s]) => [...s]));

for (const [name, keys] of keySets) {
  const missing = [...union].filter((k) => !keys.has(k));
  if (missing.length) {
    fail(`${FILES[name]} is missing: ${missing.join(', ')} — these are undefined at runtime in ${name}`);
  }
}
if (!failures) ok(`all ${union.size} keys present in all three environments`);

// ── 2. Values that must differ per environment ────────────────────────────
const EXPECTED = {
  development: { production: 'false', indexable: 'false' },
  staging: { production: 'false', indexable: 'false' },
  production: { production: 'true', indexable: 'true' },
};

for (const [name, expected] of Object.entries(EXPECTED)) {
  for (const [key, want] of Object.entries(expected)) {
    const got = parsed[name]?.[key];
    if (got !== want) {
      fail(`${FILES[name]}: ${key} should be ${want}, found ${got ?? 'nothing'}`);
    }
  }
}
if (!failures) ok('production and indexable flags correct for every environment');

// ── 3. No shared origins ──────────────────────────────────────────────────
for (const key of ['apiUrl', 'siteUrl']) {
  const seen = new Map();
  for (const [name, entries] of Object.entries(parsed)) {
    const value = entries[key];
    if (!value) continue;
    if (seen.has(value)) {
      fail(`${key} "${value}" is shared by ${seen.get(value)} and ${name} — one environment is pointing at another's infrastructure`);
    }
    seen.set(value, name);
  }
}
ok('apiUrl and siteUrl are distinct per environment');

// ── 4. Backend config keys are documented ─────────────────────────────────
console.log('\n── Backend env documentation ───────────────────────────────');

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const documented = new Set(
  existsSync(ENV_EXAMPLE)
    ? readFileSync(ENV_EXAMPLE, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split('=')[0].trim())
    : [],
);

const used = new Set();
for (const file of walk(BE_SRC)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
  for (const m of src.matchAll(/config(?:Service)?\.get(?:OrThrow)?<[^>]*>\(\s*['"]([A-Z0-9_]+)['"]/g)) used.add(m[1]);
  for (const m of src.matchAll(/config(?:Service)?\.get(?:OrThrow)?\(\s*['"]([A-Z0-9_]+)['"]/g)) used.add(m[1]);
}

const undocumented = [...used].filter((k) => !documented.has(k) && k !== 'NODE_ENV');
if (undocumented.length) {
  fail(`read by the backend but absent from .env.example: ${undocumented.join(', ')}`);
} else {
  ok(`all ${used.size} backend config keys are documented in .env.example`);
}

// 4b. And in the deploy guide, which is a different failure from the one
// above. .env.example was complete while docs/DEPLOYMENT.md was missing nine
// keys including SITE_URL — and the API refuses to start without that one, so
// anyone provisioning a new environment from the guide deployed a backend
// that would not boot. Being in .env.example does not help someone reading
// the guide; only being in the guide does.
const DEPLOY_DOC = join(ROOT, 'docs/DEPLOYMENT.md');
if (existsSync(DEPLOY_DOC)) {
  const guide = readFileSync(DEPLOY_DOC, 'utf8');
  const missing = [...used].filter((k) => k !== 'NODE_ENV' && !guide.includes(k));
  if (missing.length) {
    fail(`read by the backend but absent from docs/DEPLOYMENT.md: ${missing.join(', ')}`);
  } else {
    ok('every backend config key also appears in the deploy guide');
  }
}

const unused = [...documented].filter((k) => !used.has(k));
if (unused.length) warn(`documented but never read (may be consumed by a platform, not the code): ${unused.slice(0, 8).join(', ')}`);

// ── 5. Nothing gates deployment behaviour on NODE_ENV ─────────────────────
console.log('\n── Deployment gating (APP_ENV, not NODE_ENV) ───────────────');

// Files where a NODE_ENV check would change behaviour between staging and
// production. Build tooling and logging config legitimately use NODE_ENV, so
// only these behavioural areas are policed.
const GATED_AREAS = [
  ['backend/src/modules/seo', 'search indexability'],
  ['backend/src/main.ts', 'CORS origins and bootstrap'],
  ['backend/src/config/environment.ts', 'environment resolution'],
];

let gatingProblems = 0;
for (const [target, what] of GATED_AREAS) {
  const full = join(ROOT, target);
  const files = existsSync(full) && !full.endsWith('.ts') ? walk(full) : existsSync(full) ? [full] : [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    // Ignore the file that defines the distinction — it must mention both.
    if (file.endsWith('config/environment.ts')) continue;

    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('*') || trimmed.startsWith('//');
      // Reading NODE_ENV to *report* it is fine and useful — the bootstrap log
      // prints both values side by side. What is not fine is branching on it.
      // A line that mentions APP_ENV too is reporting, not gating.
      const alsoMentionsAppEnv = /APP_ENV|appEnv\(/.test(line);

      if (/NODE_ENV/.test(line) && !isComment && !alsoMentionsAppEnv) {
        gatingProblems++;
        fail(`${target}:${i + 1} gates ${what} on NODE_ENV — use APP_ENV. NODE_ENV is 'production' on staging too.`);
      }
    });
  }
}
if (!gatingProblems) ok('no deployment behaviour is gated on NODE_ENV');

// APP_ENV and SITE_URL must be declared on every deployment target.
const renderPath = join(ROOT, 'render.yaml');
if (existsSync(renderPath)) {
  const render = readFileSync(renderPath, 'utf8');

  /**
   * ⚠️ PARSED, not grepped, and checked PER SERVICE.
   *
   * This read the whole file as one string: `/key: APP_ENV\n value: production/`
   * against the text, and `/branch: develop/` against the text. With one
   * service in the blueprint that was the same thing as checking the pair. The
   * day production was added as a second service it stopped being:
   * APP_ENV=production matched the production block, branch: develop matched
   * the STAGING block, and the check failed a file in which every service was
   * correctly configured.
   *
   * A cross-service false positive is the mirror of the vacuous pass this
   * repository keeps finding — same cause, which is a check that cannot tell
   * which subject it is looking at.
   */
  let services;
  try {
    services = yaml.load(render)?.services;
  } catch (err) {
    fail(`render.yaml does not parse as YAML: ${err.message}`);
    services = null;
  }

  if (!Array.isArray(services) || !services.length) {
    if (services !== null) fail('render.yaml declares no services — nothing to check');
  } else {
    for (const svc of services) {
      const name = svc?.name ?? '(unnamed service)';
      const env = Object.fromEntries(
        (svc?.envVars ?? []).map((e) => [e.key, 'value' in e ? e.value : undefined]),
      );

      for (const key of ['APP_ENV', 'SITE_URL']) {
        if (!(key in env)) {
          fail(`render.yaml: ${name} does not declare ${key} — the API refuses to start without it`);
        }
      }

      // The pair, on ONE service. `develop` is staging's branch; a service on
      // it claiming production would be a crawlable copy of production.
      if (env.APP_ENV === 'production' && svc.branch === 'develop') {
        fail(`render.yaml: ${name} deploys the develop branch but sets APP_ENV=production — staging would be indexable`);
      }
      // And the reverse, which is how production stops being indexed at all.
      if (env.APP_ENV === 'staging' && svc.branch === 'master') {
        fail(`render.yaml: ${name} deploys master but sets APP_ENV=staging — production would refuse every crawler`);
      }
    }
    /**
     * ⚠️ SITE_URL must be the SAME STRING the frontend builds for that
     * environment. Nothing compared them until 13 October, and all three
     * places disagreed: environment.staging.ts said `mastande.vercel.app`, a
     * host that has never existed; render.yaml said `staging.umastande.co.za`;
     * and staging actually serves from `rentboard-za1.vercel.app`.
     *
     * It matters beyond tidiness: SITE_URL builds sitemap.xml, robots.txt and
     * every canonical URL, so a wrong one points the whole SEO surface of an
     * environment at a domain that does not answer — and it is invisible,
     * because the API starts perfectly well with it.
     *
     * Keyed on APP_ENV rather than service name, so renaming a service cannot
     * quietly drop the check.
     */
    const frontendSiteUrl = (envName) => {
      const file = join(ROOT, 'frontend/src/environments', `environment.${envName}.ts`);
      if (!existsSync(file)) return null;
      const m = readFileSync(file, 'utf8').match(/siteUrl:\s*'([^']+)'/);
      return m ? m[1] : null;
    };

    for (const svc of services) {
      const env = Object.fromEntries(
        (svc?.envVars ?? []).map((e) => [e.key, 'value' in e ? e.value : undefined]),
      );
      const appEnv = env.APP_ENV;
      if (!appEnv || !env.SITE_URL) continue;
      const fe = frontendSiteUrl(appEnv === 'production' ? 'prod' : appEnv);
      if (fe === null) continue;
      if (fe !== env.SITE_URL) {
        fail(
          `render.yaml: ${svc.name} sets SITE_URL=${env.SITE_URL}, but `
          + `environment.${appEnv === 'production' ? 'prod' : appEnv}.ts builds ${fe} — `
          + 'sitemap, robots.txt and every canonical would name a different host than the site',
        );
      }
    }

    if (!failures) {
      ok(`render.yaml: ${services.length} service(s) declare APP_ENV and SITE_URL, each matching its own branch and its frontend`);
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
if (failures) {
  console.log(`  ${failures} parity failure(s)`);
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log('  Environments are in parity.');
console.log('════════════════════════════════════════════════════════════\n');
