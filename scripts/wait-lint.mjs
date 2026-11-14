#!/usr/bin/env node
/**
 * A click that expects a navigation must wait for the URL, not for a clock.
 *
 *   node scripts/wait-lint.mjs
 *
 * ── Why this exists
 *
 * `search-drive.mjs` clicked a room card, waited with
 * `waitForLoadState('networkidle')` and then read `page.url()`. After a click
 * the ROUTER handles there is no document load, and `networkidle` can resolve
 * at once because the network was already idle — so the assertion read the URL
 * while the navigation was still in flight. It passed on this container every
 * time and failed the first CI run of the drive suite, reporting "a room page
 * opened — http://localhost:4200/?q=Accommodation%20in%20Johannesburg", the
 * page it had never left. Three more assertions failed behind it, one of them
 * quoting the previous section's search, which read like a second bug.
 *
 * The distinction this gate enforces:
 *
 *   · asserting that something DID navigate  ->  wait for the URL
 *   · asserting that nothing navigated       ->  a delay is the only option,
 *                                                because there is no event to
 *                                                wait for
 *
 * A fixed delay in the first case is a bet on how fast the box is, and the
 * suite now runs on a GitHub runner as well as here.
 *
 * ── How it decides
 *
 * It finds a click, press or tap followed within six lines by a read of
 * `.url()`, and asks what sits between them. `waitForURL` or
 * `waitForNavigation` passes. Anything else is reported unless the site is
 * allowlisted below with a reason.
 *
 * ⚠️ It cannot tell "expects a navigation" from "expects none" by itself —
 * that is what the allowlist is for, and every entry carries why. A new
 * negative assertion has to be added deliberately, which is the point: the
 * person adding it has to say out loud that they mean it.
 */
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Sites where the assertion is that the click did NOT navigate. A delay is
 * correct here: there is no URL to wait for, and `waitForURL` would wait out
 * its timeout on every run.
 */
const ASSERTS_NO_NAVIGATION = new Map([
  ['account-lifecycle-ui-drive.mjs', 'a wrong password must LEAVE you on /account/close, and a changed password on /account/settings'],
  ['dashboard-ui-drive.mjs', 'marking rent paid must keep you on the yard — the check fails if it navigated'],
  ['session-expiry-drive.mjs', 'a refused save must leave you on the form with your typing in it'],
]);

const files = readdirSync('scripts').filter((f) => f.endsWith('.mjs'));
const bad = [];
let checked = 0;

/**
 * ⚠️ Comments and blank lines are dropped BEFORE the window is taken, and
 * falsification is why.
 *
 * The first version sliced the next six raw lines. Reintroducing the exact
 * defect this gate exists for — `waitForLoadState('networkidle')` back in
 * search-drive — and it reported green, because the ⚠️ comment explaining the
 * fix now sat between the click and the assertion and pushed the `.url()` read
 * out of the window.
 *
 * So the better a site was documented, the less this could see it. A gate with
 * that incentive is worse than none.
 */
const codeOnly = (lines) => lines
  .map((text, n) => ({ text, n: n + 1 }))
  .filter(({ text }) => text.trim() && !/^\s*(\*|\/\/|\/\*)/.test(text));

for (const f of files) {
  const code = codeOnly(readFileSync(`scripts/${f}`, 'utf8').split('\n'));
  for (let i = 0; i < code.length; i++) {
    const { text: line, n } = code[i];
    if (!/\.click\(|\.press\(|\.tap\(/.test(line)) continue;
    const window = code.slice(i + 1, i + 7);
    const urlAt = window.findIndex((w) => /\.url\(\)/.test(w.text));
    if (urlAt === -1) continue;
    checked++;
    const between = window.slice(0, urlAt).map((w) => w.text).join('\n');
    if (/waitForURL|waitForNavigation/.test(between)) continue;
    if (ASSERTS_NO_NAVIGATION.has(f)) continue;
    bad.push({ f, line: n, click: line.trim().slice(0, 70) });
  }
}

console.log('\n── A click that expects a navigation waits for the URL ─────');
console.log(`  ${checked} click(s) followed by a URL read, across ${files.length} script(s).`);
console.log(`  ${ASSERTS_NO_NAVIGATION.size} file(s) allowlisted, each with a reason in the source.`);
if (!checked) {
  console.log('  ❌ nothing matched at all — this gate has stopped being able to see its subject');
  process.exit(1);
}
if (bad.length) {
  for (const b of bad) console.log(`  ❌ ${b.f}:${b.line}  ${b.click}`);
  console.log(`\n  ${bad.length} click(s) read the URL after a delay rather than after waitForURL.`);
  console.log('  If the assertion is that NOTHING navigated, add the file to');
  console.log('  ASSERTS_NO_NAVIGATION with the reason. Otherwise wait for the URL.');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log('  ✅ every click that reads the URL afterwards waits for it.');
console.log('════════════════════════════════════════════════════════════\n');
