import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import compression from 'compression';
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

  /**
   * The hostnames the platform says this deployment answers on.
   *
   * Vercel sets these at runtime: VERCEL_URL is the deployment's own
   * hostname, VERCEL_BRANCH_URL the branch alias, and
   * VERCEL_PROJECT_PRODUCTION_URL the project's production domain. They are
   * bare hostnames, no scheme.
   *
   * Without them a production build deployed anywhere other than the domain
   * in its environment file answers **400** to every route the Angular engine
   * handles — measured, not assumed: /auth/login returned 400 with a 67-byte
   * body on a preview host, while the prerendered pages kept working because
   * the middleware above serves those from disk before the engine sees them.
   * A site that is half 400 and half fine is worse than one that is plainly
   * broken, and it would have been the state of every preview deployment.
   *
   * This is deliberately not a `*.vercel.app` wildcard. The platform names
   * the exact hostnames it is serving; a wildcard would also accept a
   * deployment belonging to somebody else.
   */
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = process.env[key]?.trim();
    if (host) hosts.add(host);
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
        // Relative to browserDistFolder, not absolute — see the sendFile
        // call below for why that distinction decides whether the page is
        // served at all.
        pages.set(route === '/' ? '/' : route, relative(browserDistFolder, full));
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

/**
 * gzip, before anything else can write a response.
 *
 * Vercel compresses at its edge, so production was never shipping uncompressed
 * bytes — but the Lighthouse job serves this file directly, which meant
 * `uses-text-compression` flagged 382–386 KiB on every run and the whole
 * performance budget was being measured against a page no visitor receives. A
 * budget that only fails in the harness teaches people to ignore it.
 *
 * It also stops this being Vercel-shaped: anywhere else this server runs — a
 * container, a VM, Render — now compresses without depending on an edge that
 * happens to do it for us.
 *
 * First in the chain on purpose. compression() decides by sniffing the
 * Content-Type and length of what the handlers below write, so it has to be
 * installed before they run.
 */
app.use(compression());

/**
 * robots.txt and sitemap.xml, from the API that generates them.
 *
 * Both are served by the backend (seo.controller.ts) — on the API host. A
 * crawler reads robots.txt from the origin it is crawling and nowhere else, so
 * `https://api.<site>/robots.txt` governs the API and says nothing about the
 * site. At the site's own origin both paths fell through to the catch-all and
 * answered **200 with the "Page not found" HTML page**: no robots.txt at all
 * (so every Disallow in it was inert), and a sitemap URL that would have been
 * submitted to Search Console as a 200-with-HTML soft 404. Lighthouse found
 * it — its robots-txt audit reported 58 "syntax not understood" errors,
 * because it was parsing our 404 page line by line.
 *
 * Proxied rather than copied so there stays one generator: the sitemap has to
 * be built from live rooms, and robots.txt differs per deployment (staging
 * disallows everything). The production deployment is static, so vercel.json
 * carries the same two rewrites at the edge — see the comment there. This
 * route is what makes development, `node server.mjs` and the Lighthouse job
 * behave the way the deployed site does.
 *
 * Cached for five minutes in memory: a crawler asking for robots.txt must not
 * put a request on the API every time, and the content changes on deploy.
 */
const SEO_FILE_TTL_MS = 5 * 60 * 1000;
const seoFileCache = new Map<string, { body: string; type: string; at: number }>();

/**
 * What to serve when the API cannot be reached.
 *
 * It answers from `environment.indexable` — the deployment's own statement
 * about whether it should be in an index — rather than picking a direction.
 *
 * The first version of this served `Disallow: /` on any failure, reasoning
 * that refusing a crawl is the safe direction. It is the opposite. A missing
 * robots.txt means "crawl freely"; a robots.txt that says Disallow: / is an
 * instruction Google obeys, and obeying it on a live site removes pages from
 * the index. It also broke the thing it was meant to fix: Lighthouse read the
 * fallback, correctly concluded every page was blocked, and SEO went from
 * 0.92 to 0.66 with `is-crawlable` at 0 — worse than the missing file had
 * been, and found only because the CI run was read afterwards.
 *
 * So the fallback states the truth this bundle already knows. Production
 * allows, with the same private-area exclusions the API's own robots.txt
 * carries; staging and development disallow, matching their meta tag and the
 * X-Robots-Tag header set in vercel.json.
 */
function fallbackRobots(): string {
  if (!environment.indexable) {
    return ['User-agent: *', 'Disallow: /', ''].join('\n');
  }
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# Private and authenticated areas — no SEO value, and must not be crawled.',
    'Disallow: /auth/',
    'Disallow: /tenant/',
    'Disallow: /landlord/',
    'Disallow: /account/',
    'Disallow: /admin/',
    'Disallow: /api/',
    '',
    `Sitemap: ${environment.siteUrl.replace(/\/$/, '')}/sitemap.xml`,
    '',
  ].join('\n');
}

app.get(['/robots.txt', '/sitemap.xml'], async (req, res) => {
  const path = req.path;
  const cached = seoFileCache.get(path);
  if (cached && Date.now() - cached.at < SEO_FILE_TTL_MS) {
    res.setHeader('Content-Type', cached.type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(cached.body);
    return;
  }

  // environment.apiUrl ends in /api; these two live above it, next to /health.
  const origin = environment.apiUrl.replace(/\/api\/?$/, '');

  try {
    const upstream = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const body = await upstream.text();
    const type = upstream.headers.get('content-type')
      ?? (path === '/robots.txt' ? 'text/plain' : 'application/xml');
    seoFileCache.set(path, { body, type, at: Date.now() });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(body);
  } catch (err) {
    console.error(`[seo] ${path} could not be fetched from ${origin}:`, err);
    if (path === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(fallbackRobots());
    } else {
      // Never a 200 with the wrong body: a sitemap that answers 503 is
      // retried, and one that answers 200 with an error page is believed.
      res.status(503).setHeader('Retry-After', '120');
      res.type('text/plain').send('Sitemap temporarily unavailable.');
    }
  }
});

/**
 * TEMPORARY — remove before this branch merges.
 *
 * Every route the Angular engine has to render answers 200 with the 4.8 KB
 * client shell on Vercel, while the same build renders them locally. This
 * reports what the function actually sees, because three theories about it
 * have already been wrong.
 */
app.get('/__diag', async (req, res) => {
  let engine: unknown;
  try {
    const probe = await angularApp.handle(
      new Request(`https://${req.headers.host}/definitely-not-a-route`, {
        headers: { host: String(req.headers.host ?? '') },
      }) as never,
    );
    if (probe) {
      const body = await (probe as Response).text();
      engine = {
        status: (probe as Response).status,
        type: (probe as Response).headers.get('content-type'),
        bytes: body.length,
        // The rendered not-found page carries the marker and is ~17 KB; the
        // client shell is ~4.8 KB and carries nothing. That difference is the
        // whole question.
        rendered: /mastande-status/.test(body),
        title: /<title>([^<]*)</.exec(body)?.[1] ?? null,
      };
    } else {
      engine = null;
    }
  } catch (err) {
    engine = { threw: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }

  res.json({
    request: {
      url: req.url,
      originalUrl: req.originalUrl,
      path: req.path,
      host: req.headers.host,
      forwardedHost: req.headers['x-forwarded-host'],
      forwardedProto: req.headers['x-forwarded-proto'],
    },
    allowedHosts: serverAllowedHosts,
    env: {
      VERCEL: process.env['VERCEL'] ?? null,
      VERCEL_URL: process.env['VERCEL_URL'] ?? null,
      VERCEL_BRANCH_URL: process.env['VERCEL_BRANCH_URL'] ?? null,
      VERCEL_PROJECT_PRODUCTION_URL: process.env['VERCEL_PROJECT_PRODUCTION_URL'] ?? null,
      NG_ALLOWED_HOSTS: process.env['NG_ALLOWED_HOSTS'] ?? null,
      NODE_VERSION: process.version,
      cwd: process.cwd(),
    },
    build: {
      browserDistFolder,
      prerenderedPages: prerenderedPages.size,
    },
    engineProbe: engine,
  });
});

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
  // Root-scoped, and that is not a style preference.
  //
  // `res.sendFile(absolutePath)` refuses any path containing a dot-prefixed
  // segment: send's `dotfiles` option defaults to 'ignore' and it inspects
  // the WHOLE path, so a deployment that happens to live under a directory
  // like `.vercel/output/functions/ssr.func` makes every prerendered page
  // answer 404 — with an Express error page, on the pages that matter most.
  // That is not hypothetical; it is what the Build Output API bundle did the
  // first time it was booted.
  //
  // With `root`, send only checks the part below it, and it also confines
  // what can be served to the build folder, which is the right constraint for
  // a path that comes from a map rather than from the request.
  res.sendFile(file, { root: browserDistFolder }, (err) => {
    if (err) next(err);
  });
});

/**
 * The marker a "not found" page renders about itself.
 *
 * Angular 21 takes a response status from the matched SERVER route, and a
 * component cannot set one. That is fine for '/a/b/c', which reaches the
 * catch-all — but a ':lang' server route matches any single segment, because
 * server route matching happens before localeMatchGuard can rule the segment
 * out. So '/foo' matched ':lang', '/xx/pricing' matched ':lang/pricing', and
 * both rendered the not-found page under 200. Enumerating the ten locales in
 * serverRoutes instead is rejected by the build, since the client tree
 * declares them under a ':lang' parameter.
 *
 * So the page that IS the 404 says so, and this turns that into the status:
 * error-page.ts and room-detail.ts render <meta name="mastande-status"
 * content="404"> and nothing else does. One string, checked in one place,
 * rather than a second copy of the route table living out here and drifting
 * from the first.
 */
const STATUS_MARKER =
  /<meta[^>]*name=["']mastande-status["'][^>]*content=["'](\d{3})["']/i;

/**
 * Statuses a page is allowed to ask for.
 *
 * 404 for a page that is genuinely not there, 503 for one we could not build
 * because something we depend on did not answer. Anything else in the markup
 * is ignored rather than trusted: this is the one place a rendered page can
 * change an HTTP status, so it gets a list, not a parse.
 */
const ALLOWED_MARKER_STATUSES = new Set([404, 503]);

// No path pattern — this already matches every request that reaches it,
// and Express 5's path-to-regexp no longer accepts '/**' as a route pattern.
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(async (response) => {
      if (!response) return next();

      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('text/html') || response.status !== 200) {
        return writeResponseToNodeResponse(response, res);
      }

      const html = await response.text();
      // A regex, not an exact string: emulated view encapsulation puts an
      // _ngcontent attribute inside the tag, so the literal never matched —
      // the marker was in the HTML and the status stayed 200 until this was
      // measured on the rendered page rather than assumed from the template.
      const declared = Number(STATUS_MARKER.exec(html)?.[1]);
      const status = ALLOWED_MARKER_STATUSES.has(declared) ? declared : response.status;

      if (status === 503) res.setHeader('Retry-After', '120');
      res.status(status);
      response.headers.forEach((value, key) => {
        // Length changes with nothing else, but it is the one header that
        // becomes a lie if the body is re-sent from a string.
        if (key.toLowerCase() !== 'content-length') res.setHeader(key, value);
      });
      res.send(html);
      return undefined;
    })
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
 * Named `reqHandler`, and that name is not decorative.
 *
 * `@angular/build`'s SSR middleware does
 * `const { reqHandler } = await server.ssrLoadModule('./server.mjs')` and then
 * checks it for the `__ng_node_request_handler__` marker that
 * `createNodeRequestHandler` attaches. A default export — even a correctly
 * wrapped one — is never read, so it cannot satisfy that destructure.
 *
 * v1.62.0 got this wrong: it wrapped the default export and I confirmed the
 * warning was gone by reading `ng serve`'s log at startup. The warning is
 * emitted on the first REQUEST, not at boot, so the log was clean because
 * nothing had asked the server for a page yet.
 *
 * What the warning means, when it appears: everything in this file is
 * bypassed in development — the prerendered page map, the Cache-Control
 * downgrade on .html, and the allowedHosts check that exists to stop SSRF
 * through the Host header. Angular serves the app with its own middleware
 * instead, which is why the site still works and nothing looks wrong.
 *
 * The default export stays for anything that imports this module directly.
 * `node server.mjs` is unaffected either way: it runs the isMainModule listen
 * block above and never touches either export.
 */
export const reqHandler = createNodeRequestHandler(app);

export default app;
