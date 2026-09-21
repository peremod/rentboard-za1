import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * `index: false` used to be set here, from the Angular scaffold. It meant
 * express.static would not serve a directory's index.html — so NONE of the 19
 * prerendered pages were ever served. Every request fell through to the
 * Angular engine, which returned the 4.8 KB client-side shell: no canonical,
 * no per-page title, no description. `/pricing` served 4,803 bytes with the
 * generic site title while a fully prerendered 23,658-byte version of that
 * exact page sat unused on disk.
 *
 * That is the precise failure prerendering exists to prevent — a crawler
 * running no JavaScript saw an empty shell — and it also meant the Lighthouse
 * budgets, which boot this same server, were scoring a client-rendered shell
 * rather than the real pages.
 *
 * Without the flag, static wins for anything prerendered, and Server- and
 * Client-mode routes (rooms/:id, auth/**, tenant/**) have no file on disk so
 * they still fall through to the engine below, which is what they want.
 */
app.use(express.static(browserDistFolder, { maxAge: '1y' }));

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
  app.listen(port, () => console.log(`Node Express server listening on http://localhost:${port}`));
}

export default app;
