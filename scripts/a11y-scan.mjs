#!/usr/bin/env node
/**
 * The full axe WCAG 2.2 AA ruleset, over every page, at four widths.
 * REPORT ONLY — it always exits 0 and gates nothing.
 *
 * ── Why this exists, and why it is not a gate ───────────────────────────
 *
 * scripts/a11y-drive.mjs runs axe with `runOnly: ['color-contrast']`, and its
 * comment says why: "Turning on axe's full ruleset here would surface dozens
 * of findings at once, and a gate that is red on the day it lands is a gate
 * someone turns off. Widening it is a decision to take with the findings in
 * hand, not a default to inherit."
 *
 * Nobody had ever taken those findings. This produces them. It deliberately
 * does NOT fail, because its job is to inform that decision rather than to
 * pre-empt it — the ratchet goes into a11y-drive once somebody has chosen
 * which rules to adopt and what the baseline is.
 *
 * ── What it audits that a11y-drive does not ─────────────────────────────
 *
 * a11y-drive visits 39 pages and misses the ones with the most traffic and
 * the whole of authentication: /rooms/:id (where every wa.me share lands and
 * the apply flow lives), /auth/login, /auth/register, the password-recovery
 * set, /landlords/:slug and /landlord/rooms/new (the listing wizard). Those
 * are included here.
 *
 * ── Two deliberate measurement choices ─────────────────────────────────
 *
 *  1. The COOKIE NOTICE IS LEFT UP. It is what a real first visitor sees, it
 *     is `position: fixed`, and WCAG 2.2's 2.4.11 is about exactly that. If
 *     it carries findings they will appear on every page, which identifies it
 *     as one component rather than many faults.
 *  2. The first-run walkthrough is marked seen, for the reason a11y-drive
 *     gives: it is a full-screen sheet, and without this every portal page
 *     would be audited with a modal over it.
 *
 *   node scripts/a11y-scan.mjs
 *   WIDTHS=390 PAGES=/rooms node scripts/a11y-scan.mjs    # narrow a run
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { registerUser, apiCall, signIn, PASSWORD } from './lib/drive-session.mjs';

const require = createRequire(import.meta.url);
const WEB = process.env.BASE_URL ?? 'http://localhost:4200';
const API = process.env.API ?? 'http://localhost:3000';
const WIDTHS = (process.env.WIDTHS ?? '360,390,768,1280').split(',').map(Number);
const ONLY = process.env.PAGES ? process.env.PAGES.split(',') : null;
/**
 * Where the report goes.
 *
 * 🔴 Timestamped, and that is not decoration. This wrote to one fixed path,
 * and two narrowed investigation runs (WIDTHS=390) silently overwrote the
 * full four-width baseline it had just produced — so the before-state existed
 * only in a terminal log that happened not to have been cleared. A tool whose
 * output is evidence must not be able to destroy its own evidence.
 *
 * REPORT points at the newest run; the timestamped file is the one that keeps.
 */
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = process.env.OUT ?? `scripts/a11y-reports/a11y-scan-${STAMP}.json`;

/** WCAG 2.2 Level AA and everything it subsumes. Not best-practice. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

const axeSource = readFileSync(require.resolve('axe-core'), 'utf8');

const PUBLIC = [
  '/', '/how-it-works', '/pricing', '/advertise',
  '/legal', '/legal/terms', '/legal/privacy', '/legal/paia', '/legal/sublet',
  '/legal/disclaimer', '/legal/cookies',
  '/templates',
  // ── Not in a11y-drive. The point of this scan. ──
  '/auth/login', '/auth/register', '/auth/register-phone',
  '/auth/forgot-password', '/auth/magic', '/auth/lost-number',
];
const LANDLORD = [
  '/landlord/dashboard', '/landlord/yard', '/landlord/verification', '/landlord/services',
  '/landlord/public-page', '/landlord/properties', '/landlord/properties/ungrouped',
  '/landlord/applicants', '/landlord/templates',
  '/account/settings', '/account/notices', '/account/messages', '/account/tenancies',
  '/account/close', '/welcome',
  '/landlord/rooms/new',          // the listing wizard — not in a11y-drive
];
const TENANT = [
  '/tenant/dashboard', '/tenant/rent', '/tenant/passport', '/tenant/sublet/new',
  '/account/messages', '/account/tenancies',
];
const ADMIN = [
  '/admin/dashboard', '/admin/verifications', '/admin/reports', '/admin/disputes',
  '/admin/advertising', '/admin/referrals', '/admin/services', '/admin/surveys',
  '/admin/analytics', '/admin/recoveries',
];

const findings = [];   // one row per violating node
const scanned = [];    // {path, width, role, violations}
const errors = [];

async function scan(page, path, width, role) {
  if (ONLY && !ONLY.some((p) => path.startsWith(p))) return;
  try {
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // The board and portal lists arrive after the first paint; axe measures
    // what is on screen, so a scan that races the render audits a skeleton.
    await page.waitForTimeout(1400);
    await page.evaluate(axeSource);
    const res = await page.evaluate(async (tags) => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
      return r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, tags: v.tags,
        nodes: v.nodes.slice(0, 4).map((n) => ({
          target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
          summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 220),
        })),
        count: v.nodes.length,
      }));
    }, TAGS);
    scanned.push({ path, width, role, violations: res.length });
    for (const v of res) findings.push({ ...v, path, width, role });
    const n = res.reduce((a, v) => a + v.count, 0);
    console.log(`  ${res.length === 0 ? '\u001b[32m·\u001b[0m' : '\u001b[31m✗\u001b[0m'} ${String(width).padStart(4)}px ${path.padEnd(34)} ${res.length} rule(s), ${n} node(s)`);
  } catch (e) {
    errors.push({ path, width, role, error: e.message.split('\n')[0].slice(0, 140) });
    console.log(`  \u001b[33m?\u001b[0m ${String(width).padStart(4)}px ${path.padEnd(34)} ${e.message.split('\n')[0].slice(0, 70)}`);
  }
}

const reachable = await fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) })
  .then((r) => r.ok).catch(() => false);
const webUp = await fetch(WEB, { signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false);
if (!webUp) { console.error(`❌ no frontend on ${WEB}`); process.exit(1); }

console.log(`\naxe ${require('axe-core/package.json').version}, tags: ${TAGS.join(' ')}`);
console.log(`frontend ${WEB}, API ${reachable ? API : 'UNREACHABLE — public pages only'}`);
console.log(`widths: ${WIDTHS.join(' ')}\n`);

const browser = await chromium.launch();

// ── accounts, once ──────────────────────────────────────────────────────
let accounts = null;
if (reachable) {
  const stamp = Date.now();
  try {
    accounts = {
      LANDLORD: await registerUser(API, 'LANDLORD', stamp),
      TENANT: await registerUser(API, 'TENANT', stamp),
    };
    for (const u of Object.values(accounts)) {
      await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, u.token);
    }
    // A property and a room, so the landlord screens are not audited empty —
    // a contrast or name check over a "nothing here yet" sentence is a check
    // over the wrong page.
    const prop = await apiCall(API, 'POST', '/api/properties', {
      name: 'Ext 7 back rooms', suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng',
    }, accounts.LANDLORD.token);
    await apiCall(API, 'POST', '/api/rooms', {
      title: 'Back room with its own entrance', roomType: 'private', rentCents: 250000,
      province: 'Gauteng', city: 'Johannesburg', locationDisplay: 'Tembisa, Ekurhuleni',
      availableFrom: new Date(Date.now() + 864e5 * 14).toISOString(),
      description: 'Prepaid electricity, own entrance, space to park.',
      propertyId: prop.body?.id,
    }, accounts.LANDLORD.token);
  } catch (e) {
    console.log(`⚠️  could not set up portal accounts: ${e.message.slice(0, 120)}`);
    accounts = null;
  }
}

/** A real room id, so /rooms/:id is audited as a room and not as a 404. */
let roomPath = null;
if (reachable) {
  const board = await fetch(`${API}/api/rooms?limit=1`).then((r) => r.json()).catch(() => null);
  const id = board?.data?.[0]?.id;
  if (id) roomPath = `/rooms/${id}`;
  else console.log('⚠️  the board is empty — /rooms/:id cannot be audited. Seed with SEED_DEMO_ROOMS=true.');
}

for (const width of WIDTHS) {
  console.log(`\n════ ${width}px ════`);
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  for (const p of PUBLIC) await scan(page, p, width, 'public');
  if (roomPath) await scan(page, roomPath, width, 'public');
  await ctx.close();

  if (accounts) {
    for (const [role, paths] of [['LANDLORD', LANDLORD], ['TENANT', TENANT]]) {
      try {
        const p = await signIn(browser, WEB, accounts[role].email, PASSWORD, { width, height: 900 });
        for (const path of paths) await scan(p, path, width, role.toLowerCase());
        await p.context().close();
      } catch (e) {
        errors.push({ role, width, error: `sign-in failed: ${e.message.slice(0, 120)}` });
        console.log(`  \u001b[33m?\u001b[0m ${width}px ${role}: sign-in failed — ${e.message.slice(0, 90)}`);
      }
    }
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      try {
        const p = await signIn(browser, WEB, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { width, height: 900 });
        for (const path of ADMIN) await scan(p, path, width, 'admin');
        await p.context().close();
      } catch (e) {
        errors.push({ role: 'admin', width, error: `sign-in failed: ${e.message.slice(0, 120)}` });
        console.log(`  \u001b[33m?\u001b[0m ${width}px admin: sign-in failed — ${e.message.slice(0, 90)}`);
      }
    }
  }
}
await browser.close();

// ── aggregate ───────────────────────────────────────────────────────────
const byRule = new Map();
for (const f of findings) {
  const r = byRule.get(f.id) ?? { id: f.id, impact: f.impact, help: f.help, tags: f.tags, nodes: 0, pages: new Set(), widths: new Set(), examples: [] };
  r.nodes += f.count;
  r.pages.add(f.path);
  r.widths.add(f.width);
  if (r.examples.length < 3) r.examples.push(...f.nodes.slice(0, 1));
  byRule.set(f.id, r);
}
const RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const rules = [...byRule.values()].sort((a, b) => (RANK[a.impact] ?? 9) - (RANK[b.impact] ?? 9) || b.nodes - a.nodes);

console.log(`\n${'═'.repeat(78)}\n  RESULTS — ${scanned.length} page-scans, ${rules.length} distinct rule(s) violated\n${'═'.repeat(78)}`);
if (rules.length === 0) console.log('\n  No WCAG 2.2 AA violations found by axe.\n');
for (const r of rules) {
  console.log(`\n  [${(r.impact ?? '?').toUpperCase()}] ${r.id} — ${r.nodes} node(s) on ${r.pages.size} page(s), widths ${[...r.widths].sort((a, b) => a - b).join('/')}`);
  console.log(`      ${r.help}`);
  console.log(`      WCAG: ${r.tags.filter((t) => t.startsWith('wcag')).join(' ')}`);
  console.log(`      e.g. ${r.examples[0]?.target ?? '?'}`);
  if (r.examples[0]?.summary) console.log(`           ${r.examples[0].summary.slice(0, 150)}`);
  const sample = [...r.pages].slice(0, 6).join(', ');
  console.log(`      pages: ${sample}${r.pages.size > 6 ? `, +${r.pages.size - 6} more` : ''}`);
}
if (errors.length) {
  console.log(`\n  ⚠️  ${errors.length} page(s)/role(s) could not be scanned:`);
  for (const e of errors.slice(0, 12)) console.log(`      ${e.width ?? ''}px ${e.path ?? e.role}: ${e.error}`);
}
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')) || '.', { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  axe: require('axe-core/package.json').version,
  tags: TAGS, widths: WIDTHS,
  pageScans: scanned.length,
  rules: rules.map((r) => ({ ...r, pages: [...r.pages], widths: [...r.widths] })),
  errors,
}, null, 2));
console.log(`\n  full report: ${OUT}`);
console.log('  ⚠️  REPORT ONLY — this exits 0 by design. It informs the decision about\n      which rules a11y-drive should adopt; it does not pre-empt it.\n');
