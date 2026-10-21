#!/usr/bin/env node
/**
 * The API inventory, derived from the controllers rather than written by hand.
 *
 * ⚠️ WHY A SCRIPT AND NOT A DOCUMENT.
 *
 * A hand-written endpoint list is wrong the first time somebody adds a route,
 * and nothing tells you. This repository has shipped that defect in several
 * other shapes — a nav audit that could not see a dead link, a row-shaped
 * check that only found what somebody thought to list. So the inventory is
 * read out of the source every time it is asked for, and
 * `--check` fails when the counts move, which is what makes it a gate rather
 * than a snapshot.
 *
 *   node scripts/api-inventory.mjs            # the table
 *   node scripts/api-inventory.mjs --json     # machine-readable
 *   node scripts/api-inventory.mjs --check    # fail if it disagrees with the baseline
 *
 * What it reads per route: HTTP method, full path, the guards that actually
 * apply (class-level plus method-level), the rate limit, the success status,
 * the body DTO, and the swagger summary. Guards are the authorisation story
 * in this app — they run inside Nest's pipeline and nothing else enforces
 * who may call what — so a route with none is reported as PUBLIC rather than
 * left blank.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'backend/src');
const BASELINE = join(ROOT, 'scripts/api-inventory.baseline.json');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options'];

/** Decorator arguments are a string literal or nothing. */
function literal(arg) {
  if (!arg) return '';
  const m = arg.match(/^\s*['"`]([^'"`]*)['"`]/);
  return m ? m[1] : '';
}

/**
 * Read a decorator's arguments with the parentheses balanced.
 *
 * ⚠️ `[^)]*` was not enough and the sweep caught it: `@UseGuards(AuthGuard('google'))`
 * came back as `AuthGuard('google'` — a guard name that matches nothing and
 * reads as corrupt in the table.
 */
function args(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}

/**
 * ⚠️ ONE FILE CAN HOLD SEVERAL CONTROLLERS, and reading only the first is how
 * this tool reported two PUBLIC routes as guarded.
 *
 * `lost-number.controller.ts` declares `@Controller('admin/recoveries')` and
 * then `@Controller('auth/lost-number')`; `storefront.controller.ts` declares
 * `@Controller('landlord/storefront')` and then `@Controller('storefronts')`.
 * Taking the first prefix and the first class-level @UseGuards for the whole
 * file put `POST /auth/lost-number/confirm` in the inventory as
 * `POST /admin/recoveries/confirm` behind JwtAuthGuard + AdminGuard, and
 * `GET /storefronts/:slug` as `GET /landlord/storefront/:slug` behind
 * JwtAuthGuard + LandlordGuard.
 *
 * Both are open to the world. The auth sweep then "passed" them as refusals
 * while the real routes were never called at all — a list wrong in the one
 * direction that cannot be noticed by anything downstream of it, which is
 * exactly the family of defect this repository keeps finding. The sweep found
 * it on its first run, because a guarded route answering 404 to everybody is
 * not a thing that happens.
 */
function controllerBlocks(src) {
  const blocks = [];
  const re = /@Controller\(/g;
  const starts = [];
  let m;
  while ((m = re.exec(src))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : src.length;
    blocks.push({ text: src.slice(from, to), prefix: literal(args(src, src.indexOf('(', from))) });
  }
  return blocks;
}

function parse(file) {
  const whole = readFileSync(file, 'utf8');
  const rel = file.slice(ROOT.length + 1);
  const routes = [];

  for (const block of controllerBlocks(whole)) {
    const src = block.text;
    const prefix = block.prefix;

    // Class-level guards apply to every route in THIS controller.
    const classEnd = src.search(/export\s+class|^\s*class\s/m);
    const head = classEnd > 0 ? src.slice(0, classEnd) : '';
    const classGuards = [...head.matchAll(/@UseGuards\(/g)]
      .flatMap((m) => args(head, m.index + '@UseGuards'.length).split(',').map((x) => x.trim()).filter(Boolean));

    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const verb = lines[i].match(new RegExp(`^\\s*@(${VERBS.join('|')})\\(`));
      if (!verb) continue;
      const decoratorArgs = args(lines[i], lines[i].indexOf('('));

      let from = i;
      while (from > 0 && /^\s*(@|\/\*|\*|\/\/)/.test(lines[from - 1])) from--;
      let to = i;
      while (to < lines.length - 1 && !/^\s*(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(lines[to + 1])) to++;
      const b = lines.slice(from, Math.min(to + 6, lines.length)).join('\n');

      const guards = [...b.matchAll(/@UseGuards\(/g)]
        .flatMap((m) => args(b, m.index + '@UseGuards'.length).split(',').map((x) => x.trim()).filter(Boolean));
      const all = [...new Set([...classGuards, ...guards])];

      const throttle = b.match(/@Throttle\(\{[^}]*limit:\s*(\d+)[^}]*ttl:\s*([^,}]+)/);
      const httpCode = b.match(/@HttpCode\(\s*(?:HttpStatus\.)?([A-Z_0-9]+)\s*\)/);
      const summary = b.match(/summary:\s*['"`]([^'"`]*)['"`]/);
      const body = b.match(/@Body\(\)\s*\w+:\s*([A-Za-z0-9_]+)/);
      const params = [...b.matchAll(/@Param\(\s*['"`](\w+)['"`]/g)].map((m) => m[1]);
      const query = [...b.matchAll(/@Query\(\s*['"`](\w+)['"`]/g)].map((m) => m[1]);
      const queryDto = b.match(/@Query\(\)\s*\w+:\s*([A-Za-z0-9_]+)/);

      const sub = literal(decoratorArgs);
      const path = `/${[prefix, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/');

      const authGuards = all.filter((g) => !/Throttler/.test(g));

      routes.push({
        method: verb[1].toUpperCase(),
        path: `/api${path}`,
        file: rel,
        guards: all,
        authGuards,
        public: authGuards.length === 0,
        optionalAuth: authGuards.some((g) => /Optional/.test(g)),
        admin: authGuards.some((g) => /Admin/.test(g)),
        /** Passport's OAuth guard answers an unauthenticated caller with a redirect, by design. */
        oauth: authGuards.some((g) => /AuthGuard\(/.test(g)),
        throttle: throttle ? `${throttle[1]}/${throttle[2].trim()}` : null,
        successStatus: httpCode ? httpCode[1] : (verb[1] === 'Post' ? 'CREATED(201 default)' : 'OK(200 default)'),
        bodyDto: body ? body[1] : null,
        queryDto: queryDto ? queryDto[1] : null,
        pathParams: params,
        queryParams: query,
        summary: summary ? summary[1] : '',
      });
    }
  }
  return routes;
}

const routes = walk(SRC).flatMap(parse)
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const counts = {
  total: routes.length,
  public: routes.filter((r) => r.public).length,
  optionalAuth: routes.filter((r) => r.optionalAuth).length,
  admin: routes.filter((r) => r.admin).length,
  throttled: routes.filter((r) => r.throttle).length,
  withBody: routes.filter((r) => r.bodyDto).length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, routes }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify({ counts }, null, 2)}\n`);
  console.log(`baseline written: ${JSON.stringify(counts)}`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  if (!existsSync(BASELINE)) {
    console.error('No baseline. Run with --write-baseline once, and commit it.');
    process.exit(1);
  }
  const want = JSON.parse(readFileSync(BASELINE, 'utf8')).counts;
  const diffs = Object.keys(want).filter((k) => want[k] !== counts[k]);
  if (diffs.length) {
    console.error('❌ the API surface moved and the inventory was not refreshed:');
    for (const k of diffs) console.error(`   ${k}: baseline ${want[k]} → now ${counts[k]}`);
    console.error('\n   Review the change, then: node scripts/api-inventory.mjs --write-baseline');
    process.exit(1);
  }
  console.log(`✅ API surface unchanged: ${counts.total} routes (${counts.public} public, ${counts.admin} admin-only).`);
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  ${routes.length} routes across ${new Set(routes.map((r) => r.file)).size} controllers\n`);
console.log(`  ${pad('METHOD', 7)} ${pad('PATH', 52)} ${pad('AUTH', 34)} STATUS`);
console.log(`  ${'-'.repeat(7)} ${'-'.repeat(52)} ${'-'.repeat(34)} ------`);
for (const r of routes) {
  const auth = r.public ? (r.throttle ? `PUBLIC (rate-limited ${r.throttle})` : 'PUBLIC') : r.authGuards.join(' + ');
  console.log(`  ${pad(r.method, 7)} ${pad(r.path, 52)} ${pad(auth.slice(0, 34), 34)} ${r.successStatus}`);
}
console.log(`\n  public: ${counts.public}   optional-auth: ${counts.optionalAuth}   admin-only: ${counts.admin}   rate-limited: ${counts.throttled}   with a body DTO: ${counts.withBody}\n`);
