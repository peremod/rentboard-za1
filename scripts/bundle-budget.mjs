#!/usr/bin/env node
/**
 * Initial JavaScript budget, measured the way a visitor pays for it.
 *
 * The CI step this replaces ran:
 *
 *   find dist -name "main*.js" -path "*browser*" | xargs cat | gzip -c | wc -c
 *
 * against a 500 KB budget. Under Angular's esbuild builder `main-*.js` is a
 * small bootstrap — 7.4 KB gzipped — and every dependency lives in sibling
 * `chunk-*.js` files. So the check compared 7 KB against a 500 KB budget and
 * could not fail, no matter what was added to the app. The real initial
 * payload at the time was 111 KB gzipped, fifteen times what was measured.
 *
 * This reads index.html instead and sums the scripts the browser actually
 * fetches before the page is interactive: <script src> plus
 * <link rel="modulepreload">, which is how the builder declares the rest of
 * the initial graph. Lazy chunks are excluded by construction — they are not
 * referenced from index.html — which is the point: a route moved behind a
 * lazy import should show up here as a saving.
 *
 * gzip, not brotli: it is the floor every CDN and browser supports, so it is
 * the pessimistic number. Real transfer over Vercel will be a little smaller.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = join(root, 'frontend/dist/rentboard-frontend/browser');
const indexHtml = join(browser, 'index.html');

// Budget in gzipped bytes. The measurement when this was introduced was
// 138.5 KB, so 170 KB is roughly 23% headroom: tight enough that pulling in a
// heavy dependency trips it, loose enough that ordinary feature work does not.
// Raise it deliberately, in a commit that says why — not because the build
// went red and the number was in the way.
const BUDGET = 170 * 1024;

if (!existsSync(indexHtml)) {
  console.error(`No build to measure at ${indexHtml}. Run the production build first.`);
  process.exit(1);
}

const html = readFileSync(indexHtml, 'utf8');
const refs = new Set();
for (const m of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link[^>]+href="([^"]+\.js)"[^>]+rel="modulepreload"/g)) refs.add(m[1]);

if (refs.size === 0) {
  console.error('index.html references no scripts. That is a broken build, not a small one.');
  process.exit(1);
}

let total = 0;
const rows = [];
for (const ref of [...refs].sort()) {
  const file = join(browser, ref.replace(/^\//, ''));
  if (!existsSync(file)) {
    console.error(`index.html references ${ref}, which does not exist in the build.`);
    process.exit(1);
  }
  const gz = gzipSync(readFileSync(file), { level: 9 }).length;
  total += gz;
  rows.push({ ref, raw: statSync(file).size, gz });
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const r of rows.sort((a, b) => b.gz - a.gz)) {
  console.log(`  ${kb(r.gz).padStart(9)} gzip  ${kb(r.raw).padStart(9)} raw   ${r.ref}`);
}
console.log(`\n  Initial JavaScript: ${kb(total)} gzipped across ${rows.length} files (budget ${kb(BUDGET)})`);

if (total > BUDGET) {
  console.error(`\n❌ Over budget by ${kb(total - BUDGET)}.`);
  process.exit(1);
}
console.log(`✅ ${kb(BUDGET - total)} under budget.`);
