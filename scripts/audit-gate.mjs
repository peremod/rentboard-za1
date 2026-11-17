#!/usr/bin/env node
/**
 * The dependency gate: what blocks a merge, and what is only reported.
 *
 * ── Why this exists rather than `npm audit` alone
 *
 * `npm audit` has one exit code for "found something", and this repository has
 * two very different somethings. On the day this was written:
 *
 *   frontend production   0 vulnerabilities
 *   frontend full tree    3 high, 19 moderate — every one of them a transitive
 *                         under @angular/cli's npm tooling, with no fix inside
 *                         any range this project controls
 *
 * A gate that blocked on the second number would be red on the day it landed
 * and switched off the day after. That is not a hypothetical about this
 * codebase: CLAUDE.md lists a `MAX_ATTEMPTS` nothing read, nineteen
 * `@Throttle` decorators with no guard registered, and a nav audit incapable
 * of seeing a dead link. A gate nobody can satisfy becomes a gate nobody runs.
 *
 * So the rule is about REACHABILITY, not severity alone:
 *
 *   blocking  — critical or high in the PRODUCTION dependency tree
 *               (`npm audit --omit=dev`), because that code runs in front of
 *               real traffic
 *   advisory  — everything else: moderate and low anywhere, and anything that
 *               only exists in the build chain, which runs in CI and on
 *               developer machines but never serves a request
 *
 * Advisory findings are printed in full and counted. They are not silence;
 * they are just not a merge block.
 *
 * ── Exceptions have to cost something
 *
 * An exception needs a reason and an expiry date. Both are enforced here, not
 * by convention: an entry missing either is REJECTED and the finding still
 * blocks, and an expired entry stops suppressing. The point is that accepting
 * a risk is a decision with a review date attached, rather than a line in an
 * ignore file that outlives everyone who understood it.
 *
 * ── Self-checks
 *
 * This file checks itself before it checks the tree, in the pattern
 * scripts/keep-warm-budget.mjs uses: every expected answer below is
 * hand-computable from the fixture beside it, so the checks can be read rather
 * than trusted. They were written before the functions they test, and the
 * first run failed all eight.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['.', 'frontend', 'backend'];
const EXCEPTIONS_FILE = join(ROOT, 'scripts', 'audit-exceptions.json');
const BLOCKING = new Set(['critical', 'high']);

/**
 * Split npm audit's `vulnerabilities` map into what blocks and what is only
 * reported.
 *
 * `production` says which tree this audit came from. A finding only blocks
 * when it is critical/high AND came from the production tree.
 */
export function classify(vulnerabilities, { production }) {
  const blocking = [];
  const advisory = [];
  for (const [name, v] of Object.entries(vulnerabilities ?? {})) {
    const severity = v?.severity;
    if (!severity || severity === 'info') continue;
    const row = {
      name,
      severity,
      range: v.range ?? '',
      direct: Boolean(v.isDirect),
      fixAvailable: Boolean(v.fixAvailable),
    };
    if (production && BLOCKING.has(severity)) blocking.push(row);
    else advisory.push(row);
  }
  return { blocking, advisory };
}

/**
 * Remove blocking findings covered by a VALID, UNEXPIRED exception.
 *
 * Returns the surviving findings plus the exceptions that were applied and the
 * ones rejected, so the report can show all three. A rejected exception never
 * suppresses anything — that is the whole reason this returns them.
 */
export function applyExceptions(findings, exceptions, now) {
  const applied = [];
  const rejected = [];
  const valid = new Map();
  for (const e of exceptions ?? []) {
    if (!e?.package) {
      rejected.push({ entry: e, why: 'no package named' });
      continue;
    }
    if (!e.reason || String(e.reason).trim().length < 12) {
      rejected.push({ entry: e, why: 'no reason given (at least 12 characters)' });
      continue;
    }
    if (!e.expires || Number.isNaN(Date.parse(e.expires))) {
      rejected.push({ entry: e, why: 'no valid expiry date' });
      continue;
    }
    if (Date.parse(e.expires) < now.getTime()) {
      rejected.push({ entry: e, why: `expired on ${e.expires}` });
      continue;
    }
    valid.set(e.package, e);
  }
  const surviving = [];
  for (const f of findings) {
    const e = valid.get(f.name);
    if (e) applied.push({ ...f, reason: e.reason, expires: e.expires });
    else surviving.push(f);
  }
  return { surviving, applied, rejected };
}

/* ── Self-checks ─────────────────────────────────────────────────────────── */

function selfCheck() {
  let failed = 0;
  const is = (label, got, want) => {
    const ok = got === want;
    if (!ok) failed++;
    console.log(`  ${ok ? '\u001b[32m✅\u001b[0m' : '\u001b[31m❌\u001b[0m'} ${label} (got ${got}, want ${want})`);
  };

  const crit = { acme: { severity: 'critical', range: '<1', isDirect: true, fixAvailable: true } };
  const mod = { acme: { severity: 'moderate', range: '<1', isDirect: true, fixAvailable: true } };
  const high = { acme: { severity: 'high', range: '<1', isDirect: false, fixAvailable: true } };

  console.log('\n── Self-check: does the gate compute what it claims? ───────');
  is('nothing in, nothing blocking', classify({}, { production: true }).blocking.length, 0);
  is('a critical in PRODUCTION blocks', classify(crit, { production: true }).blocking.length, 1);
  is('a moderate in production does NOT block', classify(mod, { production: true }).blocking.length, 0);
  is('…but is reported as advisory', classify(mod, { production: true }).advisory.length, 1);
  is('a high in the BUILD CHAIN does not block', classify(high, { production: false }).blocking.length, 0);

  const f = classify(crit, { production: true }).blocking;
  const now = new Date('2026-11-17T00:00:00Z');
  const good = [{ package: 'acme', reason: 'no fix published upstream yet; tracked in issue 12', expires: '2099-01-01' }];
  is(
    'a valid unexpired exception suppresses it',
    applyExceptions(f, good, now).surviving.length,
    0,
  );
  is(
    'an EXPIRED exception does not suppress it',
    applyExceptions(f, [{ ...good[0], expires: '2020-01-01' }], now).surviving.length,
    1,
  );
  is(
    'an exception with no reason is rejected',
    applyExceptions(f, [{ package: 'acme', expires: '2099-01-01' }], now).surviving.length,
    1,
  );
  is(
    'an exception for a DIFFERENT package does not suppress it',
    applyExceptions(f, [{ package: 'other', reason: 'a perfectly good reason here', expires: '2099-01-01' }], now)
      .surviving.length,
    1,
  );
  return failed;
}

/* ── Running against the real tree ───────────────────────────────────────── */

function audit(dir, production) {
  const args = ['audit', '--json'];
  if (production) args.push('--omit=dev');
  try {
    const out = execFileSync('npm', args, {
      cwd: join(ROOT, dir),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero WHEN IT FINDS SOMETHING, so a non-zero exit is
    // the normal case and its stdout is still the report. Only an unparseable
    // body is a real failure, and it must not read as "no vulnerabilities".
    const body = err?.stdout;
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
}

function main() {
  if (selfCheck() > 0) {
    console.error('\n\u001b[31m❌ the gate cannot compute its own fixtures — refusing to judge the tree.\u001b[0m\n');
    process.exit(1);
  }

  let exceptions = [];
  if (existsSync(EXCEPTIONS_FILE)) {
    try {
      exceptions = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8')).exceptions ?? [];
    } catch {
      console.error(`\u001b[31m❌ ${EXCEPTIONS_FILE} is not valid JSON — refusing to run with an unreadable exception list.\u001b[0m`);
      process.exit(1);
    }
  }

  const allBlocking = [];
  const allAdvisory = [];
  const allApplied = [];
  const allRejected = [];
  let unreadable = 0;

  for (const ws of WORKSPACES) {
    if (!existsSync(join(ROOT, ws, 'package.json'))) continue;
    console.log(`\n── ${ws === '.' ? 'root (tooling)' : ws} ──────────────────────────────────────`);
    const prod = audit(ws, true);
    const full = audit(ws, false);
    if (!prod || !full) {
      // A scanner that cannot read its own input must not report "clean".
      console.log('  \u001b[31m❌ npm audit produced no readable JSON — NOT scanned\u001b[0m');
      unreadable++;
      continue;
    }
    const p = classify(prod.vulnerabilities, { production: true });
    // Everything in the full tree that is not already named by the production
    // pass is build-chain only.
    const prodNames = new Set(Object.keys(prod.vulnerabilities ?? {}));
    const devOnly = Object.fromEntries(
      Object.entries(full.vulnerabilities ?? {}).filter(([n]) => !prodNames.has(n)),
    );
    const d = classify(devOnly, { production: false });

    const { surviving, applied, rejected } = applyExceptions(p.blocking, exceptions, new Date());
    for (const r of surviving) allBlocking.push({ ...r, ws });
    for (const r of [...p.advisory, ...d.advisory]) allAdvisory.push({ ...r, ws });
    for (const r of applied) allApplied.push({ ...r, ws });
    for (const r of rejected) allRejected.push({ ...r, ws });

    console.log(`  production blocking : ${surviving.length}`);
    console.log(`  advisory            : ${p.advisory.length + d.advisory.length}  (${d.advisory.length} build-chain only)`);
    for (const r of surviving) {
      console.log(`    \u001b[31m❌ [${r.severity}]\u001b[0m ${r.name} ${r.range} direct=${r.direct} fixAvailable=${r.fixAvailable}`);
    }
  }

  if (allApplied.length) {
    console.log('\n── Accepted risks, with their review dates ─────────────────');
    for (const a of allApplied) console.log(`  \u001b[33m○\u001b[0m ${a.ws}: ${a.name} [${a.severity}] until ${a.expires} — ${a.reason}`);
  }
  // Deduplicated: the exception list is evaluated once per workspace, so a bad
  // entry is rejected three times and printing each one made a single typo look
  // like three problems.
  const uniqueRejected = [...new Map(allRejected.map((r) => [`${r.entry?.package}|${r.why}`, r])).values()];
  if (uniqueRejected.length) {
    console.log('\n── Exception entries REJECTED (they suppress nothing) ──────');
    for (const r of uniqueRejected) console.log(`  \u001b[31m✗\u001b[0m ${r.entry?.package ?? '(unnamed)'}: ${r.why}`);
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  blocking: ${allBlocking.length}   advisory: ${allAdvisory.length}   accepted: ${allApplied.length}   rejected exceptions: ${uniqueRejected.length}`);

  if (unreadable > 0) {
    console.error(`\n\u001b[31m❌ ${unreadable} workspace(s) could not be scanned — treating that as a failure, not a pass.\u001b[0m\n`);
    process.exit(1);
  }
  if (allBlocking.length > 0) {
    console.error(
      `\n\u001b[31m❌ ${allBlocking.length} critical/high vulnerabilit(y/ies) in PRODUCTION dependencies.\u001b[0m\n` +
        '  Fix within the existing semver range where one exists, or add a documented,\n' +
        '  expiring entry to scripts/audit-exceptions.json. A reason under 12 characters\n' +
        '  and a missing or past expiry are both rejected.\n',
    );
    process.exit(1);
  }
  console.log('\n\u001b[32m✅ no critical or high vulnerability reaches production.\u001b[0m\n');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
