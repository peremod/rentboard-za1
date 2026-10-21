#!/usr/bin/env node
/**
 * Assemble Vercel's Build Output API v3 from Angular's build.
 *
 * Why this exists rather than a setting: Vercel's Angular preset reads
 * `outputPath` from angular.json, which is `dist/mastande-frontend`, and
 * publishes that directory. Angular 17+ writes `browser/` and `server/`
 * underneath it, so the preset publishes a folder whose index.html is one
 * level down — every URL 404s, which is exactly what happened to the live
 * site when the outputDirectory override was removed on the assumption that
 * the preset would find the browser folder by itself.
 *
 * Naming `browser/` as the output directory fixes that and throws the server
 * away: the deployment is then static, room pages are client-rendered, and an
 * unknown URL cannot carry a 404. Both branches of the setting are wrong,
 * because the setting is not expressive enough to describe this build.
 *
 * `.vercel/output` is. It says exactly what to publish and how to route it,
 * and Vercel uses it in place of framework detection:
 *
 *   .vercel/output/
 *     config.json              routes: assets from disk, everything else → ssr
 *     static/                  the browser bundle, for hashed assets
 *     functions/ssr.func/      server.mjs + browser/ + an entry
 *
 * Every page — prerendered or not — goes to the function, because server.ts
 * already serves the prerendered pages from disk (see its prerenderedPages
 * map) and does so with the right Cache-Control. That keeps one code path
 * across development, `node server.mjs` and production, which is the whole
 * reason the SSR work in src/server.ts can be trusted to behave the same way
 * in all three.
 *
 *   npm run build:prod && node tools/vercel-build.mjs
 */
import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const dist = join(frontend, 'dist', 'mastande-frontend');
const browser = join(dist, 'browser');
const server = join(dist, 'server');
const out = join(frontend, '.vercel', 'output');
const fn = join(out, 'functions', 'ssr.func');

const exists = async (p) => access(p).then(() => true, () => false);

for (const [label, path] of [['browser bundle', browser], ['server bundle', server]]) {
  if (!(await exists(path))) {
    console.error(`✘ no ${label} at ${path} — run \`npm run build:prod\` first.`);
    process.exit(1);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

// Static: the browser bundle, for the hashed assets.
await cp(browser, join(out, 'static'), { recursive: true });

/**
 * 🔴 And then the CSR shell comes straight back out of it.
 *
 * This step used to end with "The HTML in here is not served from disk — the
 * function answers every page — but leaving it costs nothing and keeps the
 * directory a faithful copy of the build." It cost the home page.
 *
 * `index.csr.html` is Angular's client-side shell: a 7.6 KB document with no
 * board, no hero, no trust strip, no canonical and none of the site JSON-LD.
 * `handle: filesystem` in the routes below resolves `/` against it, so the
 * request never reaches `dest: /ssr` and the board — `RenderMode.Server`
 * precisely so a room let last week stops being advertised — has never been
 * server-rendered in production.
 *
 * Measured against the live site rather than reasoned about:
 *
 *   /                  200, 7,618 bytes, 0 room links, 0 skeletons,
 *                      0 trust-strip, 0 canonical, 0 ld-site
 *   /index.csr.html    200, 7,618 bytes — the same document, by name
 *   cache-control      public, max-age=0, must-revalidate  (Vercel's static
 *                      default, NOT the s-maxage=60 server.ts stamps on a
 *                      board it rendered)
 *   an unmatched path  404, 27,027 bytes, x-vercel-cache: MISS — the function
 *                      is healthy and rendering; it simply never gets `/`
 *
 * The cost was not only the markup. Every pixel of that page is painted by
 * JavaScript after load, which is where the board's CLS of 0.95 on a phone and
 * 0.72 on a desktop comes from: the footer moves nearly a full viewport, and
 * the cookie notice ends up being the Largest Contentful Paint element.
 *
 * So the shell is removed from the static output. It stays inside the
 * function's own browser copy, where the Angular engine reads it as the
 * template for the pages it renders — removing it there would break every
 * render. Prerendered HTML stays in static on purpose: those pages are
 * identical whichever side serves them, and serving them from the edge keeps
 * them off the function.
 */
await rm(join(out, 'static', 'index.csr.html'), { force: true });

// The function gets both halves, in the same relative layout the build uses,
// because server.ts resolves the browser folder as `../browser` from its own
// directory. Change one and the other breaks.
await cp(server, join(fn, 'server'), { recursive: true });
await cp(browser, join(fn, 'browser'), { recursive: true });

// The entry Vercel's Node launcher imports. An Express app IS a (req, res)
// handler, which is what the launcher expects as the default export.
await writeFile(
  join(fn, 'index.mjs'),
  `// Generated by tools/vercel-build.mjs — do not edit.\n` +
    `import app from './server/server.mjs';\n` +
    `export default app;\n`,
);

// ESM, explicitly. Without this the launcher can treat .mjs inconsistently
// depending on what it infers from the enclosing package.
await writeFile(join(fn, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

await writeFile(
  join(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: true,
      // A cold render of a room page waits on one API call; 15s is generous
      // and still fails fast enough to be a 504 rather than a hang.
      maxDuration: 15,
    },
    null,
    2,
  ) + '\n',
);

/** Hosts that serve a production build but are not the production site. */
const PREVIEW_HOSTS = '(staging\\.umastande\\.co\\.za|rentboard-za1\\.vercel\\.app|.*\\.vercel\\.app)';

await writeFile(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Hashed filenames, so a year is safe. `continue` means this only
        // adds a header and keeps matching.
        {
          src: '^/(.*)\\.(js|css|woff2|woff|ttf|svg|png|jpg|jpeg|webp|avif|ico|map)$',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        {
          src: '^/(.*)$',
          headers: {
            'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'x-frame-options': 'SAMEORIGIN',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
          },
          continue: true,
        },
        // A preview serving the production build must not be indexed: that
        // build says index,follow, and a copy of the site under a second
        // hostname competes with the real one for every keyword.
        {
          src: '^/(.*)$',
          has: [{ type: 'host', value: PREVIEW_HOSTS }],
          headers: { 'x-robots-tag': 'noindex, nofollow' },
          continue: true,
        },
        // /rooms has no page of its own; the board is at /.
        { src: '^/rooms$', status: 308, headers: { location: '/' } },
        // Anything on disk (the hashed assets) is served from disk.
        { handle: 'filesystem' },
        // Everything else is a page, and every page goes to the server —
        // including the prerendered ones, which it serves from disk itself.
        { src: '^/.*$', dest: '/ssr' },
      ],
    },
    null,
    2,
  ) + '\n',
);

/**
 * And then prove it, because the comment that said the shell was harmless was
 * in this file for as long as the bug was in production.
 *
 * `handle: filesystem` serves anything in `static/`, so a shell there takes
 * `/` before `dest: /ssr` ever sees it, and the symptom is a page that loads
 * and looks right in a browser — the client fills it in — while every crawler
 * and every first paint gets nothing. Nothing in this repository could see
 * that: the drives read a server that always renders, because locally
 * `server.ts` IS the server.
 *
 * Both directions are asserted. A shell in `static/` is the bug; a shell
 * missing from the function is worse, because the Angular engine reads it as
 * the template for every page it renders, so removing the wrong copy would
 * replace an unrendered home page with no pages at all.
 */
const shellInStatic = await exists(join(out, 'static', 'index.csr.html'));
const shellInFunction = await exists(join(fn, 'browser', 'index.csr.html'));

if (shellInStatic) {
  console.error(
    '✘ static/index.csr.html exists. `handle: filesystem` will serve it for `/`,\n' +
    '  the board will never reach the SSR function, and production will answer\n' +
    '  the home page with an empty client shell — no rooms, no hero, no\n' +
    '  canonical, no JSON-LD. That was live until 21 October 2026.',
  );
  process.exit(1);
}
if (!shellInFunction) {
  console.error(
    '✘ functions/ssr.func/browser/index.csr.html is missing. The Angular engine\n' +
    '  reads it as the template for every page it renders, so this would break\n' +
    '  every route rather than just the board.',
  );
  process.exit(1);
}

console.log(`✅ .vercel/output assembled`);
console.log(`   static/           ${browser.replace(frontend + '/', '')}`);
console.log(`   functions/ssr.func  server.mjs + browser/, entry index.mjs`);
console.log(`   ✅ no CSR shell in static/ — '/' reaches the SSR function`);
console.log(`   ✅ the shell IS in the function, where the engine needs it`);
