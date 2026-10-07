/**
 * Pull every route out of the actual *.routes.ts files — Mastande design handoff.
 *
 * ⚠️ From the code, never from documentation. Phase 7a of this project found
 * the navigation defined six times and disagreeing with itself, and nine nav
 * items pointing at destinations that did not exist. A route list transcribed
 * by hand, or read off a doc, is the artefact most likely to be wrong here —
 * so re-run this rather than editing its output.
 *
 *   node design-handoff/tools/routes.mjs            # JSON
 *   node design-handoff/tools/routes.mjs --md       # the markdown table
 *
 * What it understands:
 *   · `loadComponent` and `component`
 *   · `loadChildren`, followed into the feature file so a child row carries
 *     its REAL url (/landlord/properties, not /properties)
 *   · `canActivate` guards, inherited from the mount down to each child
 *   · `redirectTo`, which is a route people reach and must be in the IA
 *
 * What it deliberately leaves out:
 *   · `serverRoutes` at the foot of app.routes.ts — render-mode config, not
 *     navigable routes, and counting it would inflate the inventory
 *   · the ':lang' mirror, reported once as a note rather than doubling all 70
 *     rows. Every content route below also exists under /:lang/ for the ten
 *     non-English official languages.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const APP = 'frontend/src/app';

/**
 * Blank out comments, keeping length and newlines so every offset still lines up.
 *
 * ⚠️ This is not tidiness, it is the difference between 36 routes and 70. These
 * files are heavily commented and the comments are English prose — "the
 * landlord's own words", "it does not". An apostrophe inside a `//` comment
 * opened a string in the brace matcher, which then swallowed everything up to
 * the next apostrophe, merging route objects into their neighbours. The
 * inventory came out short and plausible, with /landlord/yard attributed to the
 * wrong component. A parser that is wrong about comments is wrong about code.
 *
 * Replaced with spaces rather than removed, so `match.index` still points at
 * the right character in the ORIGINAL text.
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0, str = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Brace-matched: a regex cannot tell a nested `children` from its parent's end. */
function blocks(src, from = 0, to = src.length) {
  const out = [];
  let i = from;
  while (i < to) {
    if (src[i] !== '{') { i++; continue; }
    let d = 0, j = i, inStr = null, prev = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (inStr) { if (c === inStr && prev !== '\\') inStr = null; }
      else if (c === "'" || c === '"' || c === '`') inStr = c;
      else if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) break; }
      prev = c;
    }
    if (j >= to) break;
    const block = src.slice(i, j + 1);
    if (/\bpath\s*:/.test(block)) out.push(block);
    i = j + 1;
  }
  return out;
}

/**
 * Fields of THIS route object, not of a nested child.
 *
 * ⚠️ The lookbehind is load-bearing. `indexOf('children')` also matches inside
 * `loadChildren`, so an earlier version truncated every lazy mount right
 * before the property that says where its children live — and quietly reported
 * 24 routes instead of 70-odd, with /landlord rendering "—". The inventory
 * looked plausible, which is the dangerous kind of wrong.
 */
const CHILDREN = /(?<![A-Za-z])children\s*:/;
const own = (b) => { const m = b.match(CHILDREN); return m ? b.slice(0, m.index) : b; };
const pick = (b, re) => (own(b).match(re) ?? [])[1] ?? null;

const PATH = /path\s*:\s*['"`]([^'"`]*)['"`]/;
const LOADC = /loadComponent\s*:[\s\S]*?then\(\s*\(?m\)?\s*=>\s*m\.(\w+)/;
const COMP = /\bcomponent\s*:\s*(\w+)/;
const LOADCH = /loadChildren\s*:\s*\(\)\s*=>\s*import\(\s*['"`]([^'"`]+)['"`]/;
const REDIR = /redirectTo\s*:\s*['"`]([^'"`]*)['"`]/;
const GUARDS = /canActivate\s*:\s*\[([^\]]*)\]/;
const TITLE = /\btitle\s*:\s*['"`]([^'"`]*)['"`]/;

/** The slice of a file holding one exported Routes array. */
function arraySlice(src, declRe) {
  const m = src.match(declRe);
  if (!m) return null;
  const start = src.indexOf('[', m.index);
  let d = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '[') d++;
    else if (src[i] === ']') { d--; if (d === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const rows = [];
const seen = new Set();

function walk(file, src, slice, prefix, inherited) {
  for (const b of blocks(slice)) {
    const p = pick(b, PATH);
    if (p === null) continue;

    const guards = [
      ...inherited,
      ...((own(b).match(GUARDS) ?? [])[1] ?? '').split(',').map((g) => g.trim()).filter(Boolean),
    ];
    const full = '/' + [prefix, p].filter((s) => s !== '' && s != null).join('/');
    const redirect = pick(b, REDIR);
    const childImport = pick(b, LOADCH);

    let component = pick(b, LOADC) ?? pick(b, COMP);
    if (!component && redirect !== null) component = `→ /${redirect}`.replace('//', '/');

    // A mount point with loadChildren is not itself a page; its children are.
    // It is still listed, because the SHELL it renders is a design surface.
    if (childImport) {
      const shell = pick(b, COMP);
      rows.push({
        file, path: full || '/', component: shell ? `${shell} (shell)` : '(mount)',
        guards, title: pick(b, TITLE), kind: 'mount',
      });
      const childFile = join(dirname(file), childImport.replace(/^\.\//, '')) + '.ts';
      try {
        const csrc = stripComments(readFileSync(childFile, 'utf8'));
        const cslice = arraySlice(csrc, /export const \w+\s*:\s*Routes\s*=/);
        if (cslice) walk(childFile, csrc, cslice, [prefix, p].filter(Boolean).join('/'), guards);
      } catch { rows.push({ file, path: full, component: `⚠️ could not read ${childFile}`, guards, kind: 'error' }); }
      continue;
    }

    const key = full + '|' + file;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      file, path: full || '/', component: component ?? '—',
      guards, title: pick(b, TITLE), redirect,
      kind: redirect !== null ? 'redirect' : 'page',
    });

    // One level of `children` under a non-lazy parent.
    const cm = b.match(CHILDREN);
    if (cm) walk(file, src, b.slice(cm.index), [prefix, p].filter(Boolean).join('/'), guards);
  }
}

const appFile = join(APP, 'app.routes.ts');
const appSrc = stripComments(readFileSync(appFile, 'utf8'));
// CONTENT_ROUTES, not `routes` — `routes` is CONTENT_ROUTES spread twice, once
// bare and once under ':lang'. Walking `routes` would list everything twice.
const content = arraySlice(appSrc, /const CONTENT_ROUTES\s*:\s*Routes\s*=/);
walk(appFile, appSrc, content, '', []);

const langMirror = /path:\s*['"`]:lang['"`]/.test(appSrc);

if (process.argv.includes('--md')) {
  const portal = (r) =>
    r.path.startsWith('/admin') ? 'Admin'
    : r.path.startsWith('/landlord') ? 'Landlord'
    : r.path.startsWith('/tenant') ? 'Tenant'
    : r.path.startsWith('/account') ? 'Account (both roles)'
    : r.path.startsWith('/auth') ? 'Auth'
    : 'Public';
  const groups = new Map();
  for (const r of rows) {
    const g = portal(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  for (const [g, list] of groups) {
    console.log(`\n### ${g} — ${list.length} route(s)\n`);
    console.log('| Path | Renders | Guards |');
    console.log('|---|---|---|');
    for (const r of list) {
      console.log(`| \`${r.path}\` | ${r.component} | ${r.guards.length ? r.guards.join(' + ') : '—'} |`);
    }
  }
  console.log(`\n_${rows.length} routes. :lang mirror: ${langMirror}_`);
} else {
  console.log(JSON.stringify({ rows, langMirror, total: rows.length }, null, 2));
}
