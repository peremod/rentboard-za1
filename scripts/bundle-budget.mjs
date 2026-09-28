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
 *
 * ── Why this boots a server ─────────────────────────────────────────────────
 *
 * It read `browser/index.html` until the board became RenderMode.Server, at
 * which point that file stopped being emitted and this exited 1 with "no build
 * to measure". The board is the page a first-time visitor actually lands on,
 * so it is the one whose initial payload matters most — and it is now the one
 * page not sitting in the build as a file.
 *
 * Measuring a prerendered page instead was the tempting fix and the wrong one.
 * Every page shares a nine-chunk initial graph and then adds its own two route
 * preloads, and the board's route chunk is the largest of them. So `/pricing`
 * would have produced a smaller number than the page being budgeted — the same
 * shape of mistake as the `main*.js` measurement this script replaced, where
 * the check compared 7 KB against 500 KB and could not fail.
 *
 * So the board is fetched from the real server bundle. Every prerendered page
 * is measured too, and the largest wins: whichever page costs the most is the
 * one held to the budget, and no page goes unmeasured.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'frontend/dist/mastande-frontend');
const browser = join(dist, 'browser');
const serverJs = join(dist, 'server/server.mjs');

// Budget in gzipped bytes. The measurement when this was introduced was
// 138.5 KB, so 170 KB is roughly 23% headroom: tight enough that pulling in a
// heavy dependency trips it, loose enough that ordinary feature work does not.
// Raise it deliberately, in a commit that says why — not because the build
// went red and the number was in the way.
const BUDGET = 170 * 1024;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!existsSync(browser)) die(`No build to measure at ${browser}. Run the production build first.`);
if (!existsSync(serverJs)) die(`No server bundle at ${serverJs}. The board cannot be measured.`);

/** Every `index.html` the prerenderer emitted, as the path a visitor would ask for. */
function prerenderedPages(dir = browser, prefix = '/') {
  const pages = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pages.push(...prerenderedPages(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name === 'index.html') pages.push(prefix);
  }
  return pages;
}

/**
 * The scripts the browser fetches before the page is interactive: `<script
 * src>` plus `<link rel="modulepreload">`, which is how the builder declares
 * the rest of the initial graph. Lazy chunks are excluded by construction —
 * they are not referenced from the document — which is the point: a route
 * moved behind a lazy import shows up here as a saving.
 */
function measure(html, where) {
  const refs = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+\.js)"[^>]+rel="modulepreload"/g)) refs.add(m[1]);

  if (refs.size === 0) die(`${where} references no scripts. That is a broken build, not a small one.`);

  let total = 0;
  const rows = [];
  for (const ref of [...refs].sort()) {
    const file = join(browser, ref.replace(/^\//, ''));
    if (!existsSync(file)) die(`${where} references ${ref}, which does not exist in the build.`);
    const gz = gzipSync(readFileSync(file), { level: 9 }).length;
    total += gz;
    rows.push({ ref, raw: statSync(file).size, gz });
  }
  return { where, total, rows };
}

/** The board is rendered per request, so the only way to read its document is to ask for it. */
async function renderedByTheServer(path) {
  const port = 41000 + (process.pid % 2000);
  const server = spawn('node', [serverJs], {
    env: { ...process.env, PORT: String(port), NG_ALLOWED_HOSTS: 'localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));

  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (server.exitCode !== null) die(`The server bundle exited before answering:\n${log}`);
      try {
        const res = await fetch(`http://localhost:${port}${path}`);
        if (res.ok) return await res.text();
        if (Date.now() > deadline) die(`${path} answered ${res.status} — expected 200.\n${log}`);
      } catch {
        if (Date.now() > deadline) die(`The server never came up on port ${port}:\n${log}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    server.kill('SIGTERM');
  }
}

const measurements = [measure(await renderedByTheServer('/'), '/ (rendered per request)')];
for (const page of prerenderedPages().sort()) {
  measurements.push(measure(readFileSync(join(browser, page.slice(1), 'index.html'), 'utf8'), page));
}

const worst = measurements.reduce((a, b) => (b.total > a.total ? b : a));

for (const r of worst.rows.sort((a, b) => b.gz - a.gz)) {
  console.log(`  ${kb(r.gz).padStart(9)} gzip  ${kb(r.raw).padStart(9)} raw   ${r.ref}`);
}
console.log(
  `\n  Initial JavaScript: ${kb(worst.total)} gzipped across ${worst.rows.length} files ` +
    `on ${worst.where} — the costliest of ${measurements.length} pages (budget ${kb(BUDGET)})`,
);
for (const m of measurements.sort((a, b) => b.total - a.total)) {
  if (m !== worst) console.log(`    ${kb(m.total).padStart(9)}  ${m.where}`);
}

if (worst.total > BUDGET) {
  console.error(`\n❌ Over budget by ${kb(worst.total - BUDGET)}.`);
  process.exit(1);
}
console.log(`\n✅ ${kb(BUDGET - worst.total)} under budget.`);
