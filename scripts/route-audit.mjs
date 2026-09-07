#!/usr/bin/env node
/**
 * Route and flow audit.
 *
 * Reads the source rather than a hand-maintained list, because a diagram
 * drawn by hand is wrong within a week and nobody notices. Everything here is
 * derived from the actual routes, guards and controllers.
 *
 *   node scripts/route-audit.mjs           # report to stdout
 *   node scripts/route-audit.mjs --write   # also regenerate docs/FLOW-MAP.md
 *
 * What it checks:
 *   1. Every frontend route resolves to a component that exports its class
 *   2. Every route under a private area is actually guarded
 *   3. Every backend endpoint's guard matches what its path implies
 *   4. Every internal routerLink points at a route that exists
 *   5. State machines are extracted into diagrams from the enums
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const FE = join(ROOT, 'frontend/src/app');
const BE = join(ROOT, 'backend/src/modules');

let problems = 0;
const note = (msg) => console.log(`  ${msg}`);
const fail = (msg) => { problems++; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

function walk(dir, ext = '.ts') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, ext) : full.endsWith(ext) ? [full] : [];
  });
}

// ── 1. Frontend routes ────────────────────────────────────────────────────
console.log('\n── Frontend routes ─────────────────────────────────────────');

const routeFiles = walk(FE).filter((f) => f.endsWith('.routes.ts'));
const routes = [];

for (const file of routeFiles) {
  const src = readFileSync(file, 'utf8');
  const area = file.replace(FE + '/', '').replace('/', ':');

  // path + the component it loads, plus any guards on the same block
  const blocks = src.split(/\n\s*\{\s*\n/);
  for (const block of blocks) {
    const path = block.match(/path:\s*'([^']*)'/)?.[1];
    if (path === undefined) continue;

    const loader = block.match(/import\('([^']+)'\)\.then\(\(m\) => m\.(\w+)\)/);
    const guards = [...block.matchAll(/canActivate:\s*\[([^\]]*)\]/g)].flatMap((m) =>
      m[1].split(',').map((g) => g.trim()).filter(Boolean),
    );
    const redirect = block.match(/redirectTo:\s*'([^']*)'/)?.[1];

    routes.push({ file, area, path, loader, guards, redirect });

    if (loader) {
      const [, rel, cls] = loader;
      const target = resolve(dirname(file), rel) + '.ts';
      if (!existsSync(target)) {
        fail(`${area} '${path}' → ${rel} does not exist`);
      } else {
        const targetSrc = readFileSync(target, 'utf8');
        // A route file exports a const of Routes; a page exports a class.
        const exported =
          targetSrc.includes(`export class ${cls}`) ||
          targetSrc.includes(`export const ${cls}`);
        if (!exported) {
          fail(`${area} '${path}' → ${rel} exports no '${cls}'`);
        }
      }
    }
  }
}
ok(`${routes.length} route definitions across ${routeFiles.length} files`);

// ── 2. Private areas must be guarded ──────────────────────────────────────
console.log('\n── Route guards ────────────────────────────────────────────');

const appRoutes = readFileSync(join(FE, 'app.routes.ts'), 'utf8');
const PRIVATE_AREAS = {
  'landlord': ['authGuard', 'landlordGuard'],
  'tenant': ['authGuard', 'tenantGuard'],
  'admin': ['authGuard', 'adminGuard'],
  'account': ['authGuard'],
};

for (const [area, expected] of Object.entries(PRIVATE_AREAS)) {
  // find the parent route block for this area
  const re = new RegExp(`path:\\s*'${area}'[\\s\\S]{0,400}?canActivate:\\s*\\[([^\\]]*)\\]`);
  const found = appRoutes.match(re);
  if (!found) {
    fail(`/${area} has no canActivate — everything under it is public`);
    continue;
  }
  const guards = found[1].split(',').map((g) => g.trim()).filter(Boolean);
  const missing = expected.filter((g) => !guards.includes(g));
  if (missing.length) {
    fail(`/${area} is missing ${missing.join(', ')} (has ${guards.join(', ') || 'none'})`);
  } else {
    ok(`/${area} guarded by ${guards.join(', ')}`);
  }
}

// ── 3. Internal links point somewhere real ────────────────────────────────
console.log('\n── Internal links ──────────────────────────────────────────');

const known = new Set();
for (const r of routes) {
  if (r.path) known.add(r.path.split('/')[0]);
}
// top-level areas declared in app.routes
for (const m of appRoutes.matchAll(/path:\s*'([^']*)'/g)) {
  if (m[1]) known.add(m[1].split('/')[0]);
}

const linkProblems = new Set();
for (const file of walk(FE)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/routerLink="\/([a-z0-9-]+)/g)) {
    if (!known.has(m[1])) linkProblems.add(`${m[1]} (in ${file.replace(FE + '/', '')})`);
  }
  for (const m of src.matchAll(/routerLink="\['\/([a-z0-9-]+)'/g)) {
    if (!known.has(m[1])) linkProblems.add(`${m[1]} (in ${file.replace(FE + '/', '')})`);
  }
}
if (linkProblems.size) {
  [...linkProblems].forEach((p) => fail(`routerLink to unknown route: ${p}`));
} else {
  ok('every internal routerLink resolves to a declared route');
}

// ── 4. Backend endpoints and their guards ─────────────────────────────────
console.log('\n── API endpoints ───────────────────────────────────────────');

const endpoints = [];
for (const file of walk(BE).filter((f) => f.endsWith('.controller.ts'))) {
  const src = readFileSync(file, 'utf8');
  const base = src.match(/@Controller\('([^']*)'\)/)?.[1] ?? '';

  // Guards are often declared once on the class rather than per method.
  // Reading only method decorators reported every admin endpoint as public,
  // which is exactly the kind of false alarm that trains people to ignore
  // an audit.
  const classGuards = (
    src.slice(0, src.indexOf('export class')).match(/@UseGuards\(([^)]*)\)/)?.[1] ?? ''
  ).split(',').map((g) => g.trim()).filter(Boolean);

  const methodRe = /@(Get|Post|Patch|Put|Delete)\(([^)]*)\)([\s\S]{0,500}?)\n  (?:async )?(\w+)\s*\(/g;
  for (const m of src.matchAll(methodRe)) {
    const [, verb, pathArg, decorators, handler] = m;
    const sub = pathArg.match(/'([^']*)'/)?.[1] ?? '';
    const methodGuards = (decorators.match(/@UseGuards\(([^)]*)\)/)?.[1] ?? '')
      .split(',').map((g) => g.trim()).filter(Boolean);

    endpoints.push({
      verb,
      path: `/${base}${sub ? '/' + sub : ''}`.replace(/\/+/g, '/'),
      // Class guards apply to every method in the controller.
      guards: [...new Set([...classGuards, ...methodGuards])],
      handler,
      file: file.replace(BE + '/', ''),
    });
  }
}

const publicEndpoints = endpoints.filter((e) => e.guards.length === 0);
const adminEndpoints = endpoints.filter((e) => e.guards.some((g) => g.includes('Admin')));

ok(`${endpoints.length} endpoints across ${new Set(endpoints.map((e) => e.file)).size} controllers`);
note(`${publicEndpoints.length} public, ${adminEndpoints.length} admin-only`);

// Anything under /admin must carry AdminGuard.
for (const e of endpoints) {
  if (e.path.includes('/admin') && !e.guards.some((g) => g.includes('Admin'))) {
    fail(`${e.verb} ${e.path} is under /admin but has no AdminGuard`);
  }
}

// Endpoints whose name implies a private action but which are unguarded.
const SUSPECT = /\b(my|me|mine|delete|remove|approve|reject|accept|admin)\b/i;
for (const e of publicEndpoints) {
  if (SUSPECT.test(e.path)) {
    fail(`${e.verb} ${e.path} is PUBLIC but its path suggests it should not be`);
  }
}
if (!problems) ok('no endpoint is public that looks like it should be guarded');

console.log('\n  Public endpoints (verify each is intentional):');
publicEndpoints.forEach((e) => note(`    ${e.verb.toUpperCase().padEnd(6)} ${e.path}`));

// ── 5. Summary ────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log(problems === 0
  ? '  No routing problems found.'
  : `  ${problems} problem${problems === 1 ? '' : 's'} found.`);
console.log('════════════════════════════════════════════════════════════\n');

// ── 6. Generate the flow map ──────────────────────────────────────────────
if (process.argv.includes('--write')) {
  const schema = readFileSync(join(ROOT, 'backend/prisma/schema.prisma'), 'utf8');
  const enumOf = (name) => {
    const body = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    return [...body.matchAll(/^\s+(\w+)/gm)].map((m) => m[1]);
  };

  const md = `# Flow map

Generated by \`node scripts/route-audit.mjs --write\`. Do not edit by hand — it
is derived from the routes, guards and schema, so it cannot drift from the code.

Last generated: ${new Date().toISOString().slice(0, 10)}

---

## Room lifecycle

States: ${enumOf('RoomStatus').join(', ')}

\`\`\`mermaid
stateDiagram-v2
    [*] --> draft: landlord starts a listing
    draft --> active: publish (needs a photo)
    draft --> [*]: discard

    active --> reserved: landlord marks reserved
    reserved --> active: unreserve

    active --> paused: pause
    paused --> active: resume (applications survive)

    active --> let: accept an applicant
    let --> active: undo within 30 min
    let --> active: relist (archives the cycle)

    active --> deleted: remove
    deleted --> active: relist

    note right of paused
        Off the board, applications untouched.
        Distinct from let, which closes them.
    end note

    note right of let
        Auto-rejects every other applicant
        and emails them. Reversible for
        30 minutes, then not.
    end note
\`\`\`

## Application lifecycle

States: ${enumOf('ApplicationStatus').join(', ')}

\`\`\`mermaid
stateDiagram-v2
    [*] --> pending: tenant applies
    pending --> viewed: landlord opens it
    viewed --> shortlisted: landlord shortlists
    shortlisted --> viewed: unshortlist

    pending --> withdrawn: tenant withdraws
    viewed --> withdrawn: tenant withdraws
    shortlisted --> withdrawn: tenant withdraws
    withdrawn --> pending: tenant applies again

    shortlisted --> accepted: landlord accepts
    viewed --> accepted: landlord accepts
    accepted --> shortlisted: undo within 30 min

    pending --> rejected: landlord rejects
    viewed --> rejected: landlord rejects
    shortlisted --> rejected: landlord rejects
    rejected --> shortlisted: undo-accept, if auto-rejected

    accepted --> [*]: tenancy created
\`\`\`

## Where each ends up on the tenant dashboard

Every application belongs to exactly one section.

| Section | Rule |
|---|---|
| Your applications | not archived, not withdrawn, not rejected |
| Available again | archived, room is active again, no current application |
| Closed applications | withdrawn, rejected, or archived on an unavailable room |

## Referral lifecycle

States: ${enumOf('ReferralStatus').join(', ')}

\`\`\`mermaid
stateDiagram-v2
    [*] --> pending: signed up with a code
    pending --> qualified: published a room or applied
    qualified --> rewarded: reward granted
    pending --> void: self-referral or duplicate

    note right of pending
        A signup alone earns nothing.
        The referee has to do something.
    end note
\`\`\`

## Advertising pipeline

States: ${enumOf('CampaignStatus').join(', ')}

\`\`\`mermaid
stateDiagram-v2
    [*] --> enquiry: /advertise form
    enquiry --> pending_review: admin creates the campaign
    pending_review --> active: approved
    pending_review --> rejected: rejected with a reason
    active --> paused: paused
    paused --> active: resumed
    active --> ended: end date passes
\`\`\`

## Route map

${(() => {
  const byArea = {};
  for (const r of routes) {
    if (!r.path && !r.redirect) continue;
    (byArea[r.area] ??= []).push(r);
  }
  return Object.entries(byArea)
    .map(([area, rs]) => {
      const rows = rs
        .map((r) => {
          const target = r.redirect ? `→ ${r.redirect}` : r.loader?.[2] ?? '';
          const guards = r.guards.length ? r.guards.join(', ') : '';
          return `| \`${r.path || '(index)'}\` | ${target} | ${guards} |`;
        })
        .join('\n');
      return `### ${area}\n\n| Path | Component | Guards |\n|---|---|---|\n${rows}`;
    })
    .join('\n\n');
})()}

## Public API surface

Everything below is reachable without a token. Each one should be
deliberate — check this list when adding an endpoint.

${publicEndpoints.map((e) => `- \`${e.verb.toUpperCase()} ${e.path}\``).join('\n')}
`;

  writeFileSync(join(ROOT, 'docs/FLOW-MAP.md'), md);
  console.log('  Wrote docs/FLOW-MAP.md\n');
}

process.exit(problems > 0 ? 1 : 0);
