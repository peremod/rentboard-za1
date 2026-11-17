#!/usr/bin/env node
/**
 * Can the keep-warm schedule in .github/workflows/keep-warm.yml actually be
 * afforded on the free tier? And how much of the day does it cover?
 *
 * ── Why this gate exists ────────────────────────────────────────────────
 *
 * keep-warm.yml declared a ten-minute schedule (the slash-10 form) for months.
 * Two things were wrong with that, and neither was visible from the Actions
 * tab, because every single run succeeded:
 *
 *   1. GitHub was not firing it. Measured on 15 November 2026 over the last 60
 *      runs (31 Oct - 15 Nov): the gap between consecutive runs ran from 170 to
 *      616 minutes, median 389. ZERO of the 59 gaps were inside the ~15-minute
 *      sleep window. A 10-minute cron would have produced 2,160 runs in that
 *      span; GitHub delivered 60. The weekly Lighthouse cron (`0 5 * * 1`) in
 *      the same repository fires every Monday without a miss but 5-8.5 hours
 *      late, which is the same magnitude - so this is GitHub's scheduler
 *      running hours behind for this repository, not a broken workflow and not
 *      a dropped job. No cron expression fixes that.
 *
 *   2. 🔴 And if GitHub HAD fired it, production would have been suspended.
 *      Render gives a workspace 750 free instance hours per CALENDAR MONTH,
 *      shared across every free service in it - and this blueprint has two
 *      (staging and production, both `plan: free`). Exceeding the allowance
 *      suspends the services for the rest of the month; there is no overage
 *      bill, there is an outage. A ping every ten minutes holds production
 *      awake around the clock, which is ~730 hours: the entire allowance, with
 *      nothing left for staging. So the broken schedule is the only reason
 *      production has not been suspended, and "fixing the cron" without this
 *      arithmetic would have taken the site down mid-month.
 *
 * ── The conclusion this script encodes ──────────────────────────────────
 *
 * There is NO cadence that both covers the sleep window and fits the free
 * allowance. Covering the window means being awake continuously, and being
 * awake continuously costs the whole allowance. The keep-warm workaround is
 * not merely broken, it is arithmetically impossible on this plan. The honest
 * options are to pay for the cheapest instance (which also restores
 * preDeployCommand - see render.yaml and OUTSTANDING §5a), or to accept cold
 * starts and stop pretending otherwise.
 *
 * Until one of those is chosen, this gate holds the declared schedule inside
 * the allowance, so that nobody tightens it back into a suspension.
 *
 * Run: node scripts/keep-warm-budget.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github/workflows/keep-warm.yml');

// ── The numbers, and where each comes from ─────────────────────────────
// Verified against Render's own documentation on 15 November 2026. The
// blueprint's header already warns that free-tier terms change, so re-check
// these before trusting a green run from a much later date.
const ALLOWANCE_HOURS = 750;   // per workspace, per calendar month, shared
const SLEEP_MINUTES = 15;      // idle minutes before a free service spins down
const DAYS_PER_MONTH = 30.44;  // 365.25 / 12

// Reserved out of the allowance before keep-warm gets any of it.
// These overlap with keep-warm's own awake time rather than adding to it (the
// hours are a union, not a sum), so reserving them separately errs on the safe
// side, which is the direction an outage budget should err in.
const RESERVE_STAGING = 120;   // deploys, CI, verify-deployment waking staging
const RESERVE_TRAFFIC = 150;   // production awake because somebody visited it
const BUDGET_HOURS = ALLOWANCE_HOURS - RESERVE_STAGING - RESERVE_TRAFFIC;

/**
 * Minutes-past-midnight at which a 5-field cron fires, for the shapes this
 * repository uses. Anything else THROWS rather than returning a guess: a
 * schedule this script cannot model must not pass the gate by default. That
 * is the whole lesson of the nineteen @Throttle decorators with no guard.
 */
export function fireMinutes(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`not a 5-field cron: "${expr}"`);
  const [min, hour, dom, mon, dow] = f;
  if (dom !== '*' || mon !== '*' || dow !== '*') {
    throw new Error(`only daily schedules are modelled; got dom=${dom} mon=${mon} dow=${dow}`);
  }
  const expand = (field, max, label) => {
    if (field === '*') return Array.from({ length: max }, (_, i) => i);
    const step = /^\*\/(\d+)$/.exec(field);
    if (step) {
      const n = Number(step[1]);
      if (!n || n > max) throw new Error(`bad step in ${label}: "${field}"`);
      return Array.from({ length: Math.ceil(max / n) }, (_, i) => i * n);
    }
    if (/^\d+(,\d+)*$/.test(field)) {
      const vals = field.split(',').map(Number);
      for (const v of vals) if (v >= max) throw new Error(`${label} out of range: ${v}`);
      return vals;
    }
    throw new Error(`unmodelled ${label} field: "${field}"`);
  };
  const minutes = expand(min, 60, 'minute');
  const hours = expand(hour, 24, 'hour');
  const out = [];
  for (const h of hours) for (const m of minutes) out.push(h * 60 + m);
  return out.sort((a, b) => a - b);
}

/**
 * Awake minutes in a day, given the fire times. Each ping resets the idle
 * timer, so a fire keeps the service up for SLEEP_MINUTES from that moment;
 * overlapping intervals are a UNION, not a sum. Wraps past midnight, because
 * the last ping of a day keeps the service up into the next one.
 */
export function awakeMinutesPerDay(fires) {
  if (fires.length === 0) return 0;
  const awake = new Uint8Array(1440);
  for (const f of fires) {
    for (let i = 0; i < SLEEP_MINUTES; i++) awake[(f + i) % 1440] = 1;
  }
  return awake.reduce((a, b) => a + b, 0);
}

export function project(expr) {
  const fires = fireMinutes(expr);
  const awakeMin = awakeMinutesPerDay(fires);
  return {
    expr,
    firesPerDay: fires.length,
    coverage: awakeMin / 1440,
    hoursPerMonth: (awakeMin / 60) * DAYS_PER_MONTH,
  };
}

// ── Self-check: the model itself, on inputs whose answers are obvious ──
// Without this the gate is one arithmetic slip away from being a check that
// cannot fail. Each case is hand-computable.
const SELF_CHECKS = [
  // every 10 min: 144 fires, each covering 15 of the next minutes -> all day
  { expr: '*/10 * * * *', firesPerDay: 144, coverage: 1 },
  // every 15 min: fires exactly as the previous window expires -> all day
  { expr: '*/15 * * * *', firesPerDay: 96, coverage: 1 },
  // every 20 min: 15 awake of every 20 -> three quarters of the day
  { expr: '*/20 * * * *', firesPerDay: 72, coverage: 0.75 },
  // hourly: 15 awake of every 60 -> a quarter of the day
  { expr: '0 * * * *', firesPerDay: 24, coverage: 0.25 },
  // every 30 min: 15 of every 30 -> half
  { expr: '*/30 * * * *', firesPerDay: 48, coverage: 0.5 },
  // twice a day, listed minutes and hours: 2 fires, 30 awake minutes
  { expr: '0 6,18 * * *', firesPerDay: 2, coverage: 30 / 1440 },
];
const SELF_REJECT = [
  '*/10 * * * 1',     // a day-of-week restriction is not modelled
  '*/10 * * *',       // four fields
  'H/10 * * * *',     // Jenkins syntax, not cron
  '0 25 * * *',       // hour out of range
  '*/0 * * * *',      // zero step
];

let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.log(`  ${ok ? '\u001b[32m✅\u001b[0m' : '\u001b[31m❌\u001b[0m'} ${text}`);
};

console.log('\n── Self-check: does the model compute what it claims? ──────');
for (const c of SELF_CHECKS) {
  const got = project(c.expr);
  say(
    got.firesPerDay === c.firesPerDay && Math.abs(got.coverage - c.coverage) < 1e-9,
    `${c.expr.padEnd(16)} -> ${got.firesPerDay} fires/day, ${(got.coverage * 100).toFixed(1)}% covered` +
      (got.firesPerDay === c.firesPerDay && Math.abs(got.coverage - c.coverage) < 1e-9
        ? ''
        : ` (expected ${c.firesPerDay} and ${(c.coverage * 100).toFixed(1)}%)`),
  );
}
for (const bad of SELF_REJECT) {
  let threw = false;
  try { project(bad); } catch { threw = true; }
  say(threw, `refuses to model "${bad}" instead of guessing`);
}

console.log('\n── The declared schedule ───────────────────────────────────');
const yaml = readFileSync(WORKFLOW, 'utf8');
// Only the schedule block's cron lines, and only uncommented ones.
const crons = yaml
  .split('\n')
  .filter((l) => /^\s*-\s*cron:/.test(l))
  .map((l) => l.replace(/^\s*-\s*cron:\s*/, '').replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, ''));

say(crons.length > 0, `found ${crons.length} cron expression(s) in ${WORKFLOW.replace(ROOT + '/', '')}`);
if (crons.length === 0) {
  console.log('\n\u001b[31mNothing to judge. A gate with no input is not a gate.\u001b[0m');
  process.exit(1);
}

let worst = null;
for (const expr of crons) {
  let p;
  try {
    p = project(expr);
  } catch (e) {
    say(false, `cannot model "${expr}": ${e.message}`);
    continue;
  }
  console.log(
    `\n  ${expr}\n` +
      `     fires/day            ${p.firesPerDay}\n` +
      `     sleep window covered ${(p.coverage * 100).toFixed(1)}%\n` +
      `     instance hours/month ${p.hoursPerMonth.toFixed(0)} of ${ALLOWANCE_HOURS} (budget ${BUDGET_HOURS})`,
  );
  if (!worst || p.hoursPerMonth > worst.hoursPerMonth) worst = p;
}

if (worst) {
  console.log('\n── Affordability ───────────────────────────────────────────');
  say(
    worst.hoursPerMonth <= BUDGET_HOURS,
    `the declared schedule projects ${worst.hoursPerMonth.toFixed(0)}h/month, within the ${BUDGET_HOURS}h left ` +
      `after ${RESERVE_STAGING}h staging and ${RESERVE_TRAFFIC}h real traffic are reserved out of ${ALLOWANCE_HOURS}h`,
  );
  if (worst.hoursPerMonth > BUDGET_HOURS) {
    console.log(
      '\n\u001b[31m  This schedule does not fit the free allowance.\u001b[0m\n' +
        '  Render suspends every free service in the workspace for the rest of the\n' +
        '  month when the 750 hours run out — an outage, not a bill. Loosen the\n' +
        '  cadence, or move off the free plan and delete this workflow.\n',
    );
  }
  console.log('\n── What it buys ────────────────────────────────────────────');
  console.log(
    `  ${(worst.coverage * 100).toFixed(1)}% of the day covered IF GitHub fires on time.\n` +
      '  Measured 15 Nov 2026, it does not: median 389 minutes between runs, and\n' +
      `  none of 59 observed gaps inside the ${SLEEP_MINUTES}-minute window. Treat the\n` +
      '  number above as a ceiling nobody has ever reached, not as coverage.',
  );
}

console.log(
  failed === 0
    ? '\n\u001b[32m✅ the keep-warm schedule is affordable, and the model that says so can fail.\u001b[0m\n'
    : `\n\u001b[31m❌ ${failed} check(s) failed.\u001b[0m\n`,
);
process.exit(failed ? 1 : 0);
