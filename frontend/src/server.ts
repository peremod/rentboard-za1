import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { environment } from './environments/environment';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();

/**
 * Hostnames this server will render for.
 *
 * Angular 21 validates the `Host` and `X-Forwarded-Host` headers against an
 * allow-list, to stop a forged Host from steering server-side fetches and
 * absolute URLs at somebody else's origin. With no list configured the check
 * rejects EVERY request — and the rejection is quiet: it logs and falls back
 * to client-side rendering, so the server returns 200 with the 4.8 KB shell.
 *
 * Which is what was happening. Every Server-mode route — `/rooms/:id` above
 * all, the pages the whole listing business depends on being indexed — was
 * served unrendered, with an error logged per request that nothing was
 * reading. Angular's own message says it becomes a hard 400 in a future major
 * version, so this was also a time bomb.
 *
 * The list is derived from the environment file the build was compiled with,
 * so each deployment allows its own site and nothing else. NG_ALLOWED_HOSTS
 * adds to it for anything the environment file cannot know about.
 */
function allowedHosts(): string[] {
  const hosts = new Set<string>();

  try {
    const host = new URL(environment.siteUrl).hostname;
    hosts.add(host);
    // Both apex and www resolve to this app in production; a visitor arriving
    // on the other one must not get an unrendered page.
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`);
  } catch {
    // A malformed siteUrl is an environment-file bug. Carry on with whatever
    // NG_ALLOWED_HOSTS provides rather than refusing to serve anything.
  }

  if (!environment.production) {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
    // Vercel gives every preview deployment a generated hostname, so staging
    // cannot enumerate them. Scoped to non-production on purpose.
    hosts.add('*.vercel.app');
  }

  for (const extra of (process.env['NG_ALLOWED_HOSTS'] ?? '').split(',')) {
    const trimmed = extra.trim();
    if (trimmed) hosts.add(trimmed);
  }

  return [...hosts];
}

const serverAllowedHosts = allowedHosts();
const angularApp = new AngularNodeAppEngine({ allowedHosts: serverAllowedHosts });

/**
 * Every prerendered page, by the URL path it answers.
 *
 * Built once at startup by walking the build output, which is immutable while
 * the server runs. An explicit map rather than a filesystem lookup per
 * request: the request path never touches the filesystem, so there is no
 * traversal to defend against, and a hit is a Map lookup.
 *
 * Both `/pricing` and `/pricing/` map to the same file. That is the whole
 * reason this exists — see the express.static comment below.
 */
function collectPrerenderedPages(): Map<string, string> {
  const pages = new Map<string, string>();

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'index.html') {
        const segments = relative(browserDistFolder, dir).split(sep).filter(Boolean);
        const route = `/${segments.join('/')}`;
        pages.set(route === '/' ? '/' : route, full);
      }
    }
  };

  try {
    walk(browserDistFolder);
  } catch {
    // An empty or missing build folder is a build problem, not a reason to
    // refuse to boot: everything falls through to the Angular engine below.
  }
  return pages;
}

const prerenderedPages = collectPrerenderedPages();

/**
 * Static assets — JS, CSS, images. All content-hashed, hence the long cache.
 *
 * `index: false` used to be set here, from the Angular scaffold, and meant
 * express.static would not serve a directory's index.html — so NONE of the
 * prerendered pages were ever served. Every request fell through to the
 * Angular engine, which returned the 4.8 KB client-side shell: no canonical,
 * no per-page title, no description. `/pricing` served 4,803 bytes with the
 * generic site title while a fully prerendered 23,658-byte version of that
 * exact page sat unused on disk. That is the precise failure prerendering
 * exists to prevent, and it also meant the Lighthouse budgets, which boot this
 * same server, were scoring a client-rendered shell rather than the real page.
 *
 * Simply dropping the flag fixed the content but introduced two new problems,
 * which is why the pages are served by the handler below instead:
 *
 *  1. express.static answers `/pricing` with a 301 to `/pricing/`, because
 *     that is what it does for a directory. Every internal link, the sitemap
 *     and every canonical tag use the unslashed form, so each one became a
 *     redirect hop.
 *  2. `maxAge: '1y'` is correct for a hashed filename and badly wrong for
 *     HTML at a stable URL. `/pricing/index.html` would have been cached for
 *     a year, still referencing `main-<oldhash>.js` — a file the next deploy
 *     deletes. The page breaks for that visitor and a reload does not fix it.
 *
 * So: no directory indexes, no redirects, and any .html that does get served
 * from here is revalidated rather than pinned.
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

/**
 * Prerendered pages, served at the exact URL asked for.
 *
 * `no-cache` means "revalidate", not "do not store": the browser keeps the
 * copy and re-checks it with an If-None-Match, so an unchanged page still
 * costs one 304 rather than a full download, and a deploy is picked up
 * immediately. Correct for HTML whose URL stays the same across releases.
 */
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const path = req.path.length > 1 && req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
  const file = prerenderedPages.get(path);
  if (!file) return next();

  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(file, (err) => {
    if (err) next(err);
  });
});

// No path pattern — this already matches every request that reaches it,
// and Express 5's path-to-regexp no longer accepts '/**' as a route pattern.
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () =>
    console.log(
      `Node Express server listening on http://localhost:${port} — ` +
        `${prerenderedPages.size} prerendered pages, ` +
        `rendering for ${serverAllowedHosts.join(', ')}`,
    ),
  );
}

/**
 * Wrapped, not bare.
 *
 * `ng serve` looks for the metadata `createNodeRequestHandler` attaches, and
 * without it prints "the 'reqHandler' export in 'server.ts' is either
 * undefined or does not provide a recognized request handler" and quietly
 * falls back to its own SSR middleware. That warning is easy to read as
 * cosmetic and is not: it means everything in this file — the prerendered
 * page map, the Cache-Control downgrade on .html, and the allowedHosts check
 * that exists to stop SSRF through the Host header — is bypassed in
 * development. Nobody was exercising the real server until production.
 *
 * The call returns the same handler it is given, so `node server.mjs` and the
 * isMainModule listen block above are unaffected.
 */
export default createNodeRequestHandler(app);
