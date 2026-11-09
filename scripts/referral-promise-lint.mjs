#!/usr/bin/env node
/**
 * No screen may tell somebody a referral pays for their verification.
 *
 * ── Why this exists
 *
 * `referral-panel.ts` told a landlord, in these words:
 *
 *   "You have N free verifications earned. It covers the R149 identity check."
 *   "When a landlord you invite publishes their first room, your R149
 *    verification is covered."
 *
 * Driven end to end against the real API (docs/OUTSTANDING.md §100): the
 * credit is granted by qualify(), counted by /referrals/mine, and rendered by
 * the panel — and NOTHING SPENDS IT. `consumeFreeVerification()` has no caller
 * anywhere in the codebase, and `requiresPayment(type, role)` takes only a
 * type and a role, so the verification flow cannot see a credit even in
 * principle. The screen made a specific promise in rands that the product
 * could not keep.
 *
 * ⚠️ The R149 is the identity VERIFICATION fee. It is a charge for a service,
 * and /legal/terms, the privacy policy and the verification screen are right
 * to name it. It is NOT a referral reward, and tying the two together was the
 * mistake. So this lint does not ban the figure — it bans the claim that
 * something else pays it.
 *
 * ── Why a lint and not a drive
 *
 * The panel is behind a dashboard, and showing the earned-credit branch needs
 * a completed referral chain. But unlike §99's house-ad advertiser — a value
 * that lived in a database row, where no source check could have seen it —
 * this promise IS the source. A sentence in a template is exactly what a
 * source check can hold.
 *
 * Comments are stripped before matching, so the paragraphs explaining this
 * decision cannot satisfy their own rule. That is deliberate: the first draft
 * passed on its own documentation.
 *
 *   node scripts/referral-promise-lint.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'frontend/src/app';

/** Template and inline-template sources only; .ts carries both here. */
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  if (statSync(p).isDirectory()) return walk(p);
  return /\.(ts|html)$/.test(p) && !/\.spec\.ts$/.test(p) ? [p] : [];
});

/**
 * ⚠️ Comments go first. A /** *\/ block, a // line and an HTML comment are all
 * explanation, not something a person reads on screen — and this file's own
 * subject is a paragraph of explanation that quotes the banned sentences.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * Each rule is the CLAIM, not the words. A rand figure on the verification
 * screen is a price; the same figure offered as a reward is a promise.
 */
const RULES = [
  {
    id: 'a referral is said to cover the fee',
    re: /verifications?\s+(is|are)\s+covered/i,
  },
  {
    id: 'something is said to cover the R149',
    re: /covers?\s+the\s+R\s?\d/i,
  },
  {
    id: 'a free verification is offered as earned or available',
    re: /free\s+verifications?\s*(\{\{|<|[a-z]*\s*)?(earned|available|you have)/i,
  },
  {
    id: 'a referral screen names the verification price',
    re: /R\s?149/i,
    onlyIn: /referral/i,
  },
  {
    /**
     * ⚠️ Found one layer down, after the two sentences were already gone: the
     * status list still labelled a completed referral "Reward earned". The
     * headline promise had been removed and the chip went on telling people
     * they were owed something. The scheme pays nothing, so no screen says a
     * reward was earned.
     */
    id: 'a reward is said to have been earned, and nothing pays one',
    re: /reward\s+(earned|available|owed)/i,
  },
];

let found = 0;
const files = walk(ROOT);

for (const file of files) {
  const rel = relative(ROOT, file);
  const body = stripComments(readFileSync(file, 'utf8'));
  for (const rule of RULES) {
    if (rule.onlyIn && !rule.onlyIn.test(rel)) continue;
    const m = rule.re.exec(body);
    if (!m) continue;
    found++;
    const line = body.slice(0, m.index).split('\n').length;
    console.log(`  ❌ ${rel}:${line} — ${rule.id}`);
    console.log(`     ${m[0].replace(/\s+/g, ' ').trim()}`);
  }
}

console.log('');
console.log(`── Referral promises ──────────────────────────────`);
console.log(`  ${files.length} source file(s) scanned, comments stripped.`);
if (found) {
  console.log(`  ❌ ${found} on-screen claim(s) that a referral pays for a verification.`);
  console.log('');
  console.log('     Nothing redeems that credit: consumeFreeVerification() has no');
  console.log('     caller, and requiresPayment(type, role) cannot see one. Either');
  console.log('     wire redemption up (OUTSTANDING §100 option 1) or do not say it.');
  process.exit(1);
}
console.log('  ✅ no screen offers a verification as a referral reward.');
console.log('════════════════════════════════════════════════════');
