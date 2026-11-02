#!/usr/bin/env node
/**
 * Prints what a Lighthouse CI run actually measured, from the LHRs on disk.
 *
 * ⚠️ This exists because `lhci upload --target=temporary-public-storage`
 * SANITISES the report it publishes. The first completed production audit
 * (run 11, 21 October 2026) measured CLS 0.953 on the board — nine times the
 * budget — and the published report carried `layout-shifts` with a null score
 * and no details at all. The culprits were in `.lighthouseci/lhr-*.json` on the
 * runner and were thrown away when the job ended, so the one number worth
 * acting on could be seen but not explained.
 *
 * So the job prints it into its own log, where `get_job_logs` and a human
 * reading the run can both reach it.
 *
 *   node scripts/lhr-summary.mjs [.lighthouseci]
 *
 * Reads every LHR in the directory, groups by URL, and prints the MEDIAN run
 * per URL — the same aggregation the assertions use. An optimistic summary
 * beside a median gate would be two halves at different scopes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2] ?? '.lighthouseci';

/**
 * A directory of lhci reports, or a single report from the standalone CLI.
 *
 * Both, because lhci 0.14 bundles Lighthouse 12.1, whose RootCauses gatherer
 * throws on this site — `Cannot read properties of undefined (reading
 * 'frame_sequence')` — so the audit that names what shifted cannot run there at
 * all. 12.8 produces it. The production job therefore runs the standalone CLI
 * once as a diagnostic beside the lhci collection, and one script reads either.
 */
let files;
try {
  if (statSync(target).isDirectory()) {
    files = readdirSync(target)
      .filter((f) => f.startsWith('lhr-') && f.endsWith('.json'))
      .map((f) => join(target, f));
  } else {
    // The path as given. `join('.', '/abs/path')` drops the leading slash and
    // the read fails on a path that exists — caught by running it.
    files = [target];
  }
} catch {
  console.log(`no ${target} — nothing collected, so nothing to summarise`);
  process.exit(0);
}
if (!files.length) {
  console.log(`${target}/ holds no lhr-*.json — nothing to summarise`);
  process.exit(0);
}

const byUrl = new Map();
for (const f of files) {
  const lhr = JSON.parse(readFileSync(f, 'utf8'));
  const url = lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl;
  if (!byUrl.has(url)) byUrl.set(url, []);
  byUrl.get(url).push(lhr);
}

const num = (lhr, id) => lhr.audits?.[id]?.numericValue ?? NaN;
const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)}ms` : 'n/a');

for (const [url, runs] of byUrl) {
  // Median BY CLS, because that is the metric this script was written for and
  // picking the median by performance score would report a different run's
  // shift value than the gate asserts on.
  const sorted = [...runs].sort((a, b) => num(a, 'cumulative-layout-shift') - num(b, 'cumulative-layout-shift'));
  const median = sorted[Math.floor((sorted.length - 1) / 2)];

  console.log(`\n── ${url}  (${runs.length} run${runs.length === 1 ? '' : 's'}, median shown)`);
  const cats = Object.entries(median.categories ?? {})
    .map(([k, v]) => `${k} ${v.score}`)
    .join('  ');
  console.log(`   ${cats}`);
  console.log(
    `   LCP ${ms(num(median, 'largest-contentful-paint'))}` +
    `  CLS ${num(median, 'cumulative-layout-shift').toFixed(3)}` +
    `  TBT ${ms(num(median, 'total-blocking-time'))}` +
    `  FCP ${ms(num(median, 'first-contentful-paint'))}`,
  );
  console.log(
    `   all CLS values: ${runs.map((r) => num(r, 'cumulative-layout-shift').toFixed(3)).join(', ')}`,
  );

  /**
   * ⚠️ WHICH audit cost the category its point.
   *
   * Added after the 2 November run failed `categories:seo >= 1` on all four
   * URLs with `found: 0.92` and nothing else — no audit named, in the
   * assertion output or in this summary. 0.92 cannot be read backwards
   * either: one weight-1 audit failing gives 11.04/12.04 = 0.917, and
   * `image-alt` becoming applicable and failing gives 12.04/13.04 = 0.923.
   * Both round to 0.92, so the arithmetic does not identify it and neither
   * did anything else the job printed.
   *
   * It is also not reproducible outside the runner: the same bundle, the same
   * config, the same lhci 0.14 and its bundled Lighthouse 12.1 all score 1.00
   * locally. A red that only happens where you cannot look is exactly the red
   * that has to explain itself in the log.
   *
   * Every category, not just SEO, and every audit below 1 whatever its
   * weight — a weight-0 audit cannot move the score, but it can be the thing
   * a human needs to see, and leaving it out is how a diagnostic ends up
   * unable to see its own subject.
   */
  for (const [catId, cat] of Object.entries(median.categories ?? {})) {
    if (cat.score === null || cat.score >= 1) continue;
    const failing = (cat.auditRefs ?? [])
      .map((ref) => ({ ref, audit: median.audits?.[ref.id] }))
      .filter(({ audit }) => audit && audit.score !== null && audit.score < 1);
    if (!failing.length) {
      console.log(`   ${catId} ${cat.score}: no audit in the category scored below 1 — nothing to attribute it to`);
      continue;
    }
    console.log(`   ${catId} ${cat.score} — what it lost it on:`);
    for (const { ref, audit } of failing) {
      const weight = typeof ref.weight === 'number' ? ref.weight.toFixed(2) : '?';
      console.log(`     · ${ref.id}  score ${audit.score}  weight ${weight}  ${audit.title ?? ''}`);
      if (audit.explanation) console.log(`       ${String(audit.explanation).slice(0, 300)}`);
      if (audit.errorMessage) console.log(`       errorMessage: ${audit.errorMessage}`);
      for (const item of (audit.details?.items ?? []).slice(0, 3)) {
        console.log(`       ${JSON.stringify(item).slice(0, 300)}`);
      }
    }
  }

  const lcpEl = median.audits?.['largest-contentful-paint-element']?.details?.items ?? [];
  for (const item of lcpEl.slice(0, 1)) {
    const node = item.items?.[0]?.node ?? item.node;
    if (node) console.log(`   LCP element: ${node.nodeLabel ?? ''} ${node.selector ?? ''}`.trim());
  }

  // The point of the whole script.
  //
  // ⚠️ Two audit ids, because Lighthouse moved this. `layout-shifts` is the
  // legacy table; `cls-culprits-insight` is the insight audit that replaced it.
  // Run 12 printed "no items reported" from the first one alone while the same
  // run measured CLS 0.916 — a diagnostic that could not see its subject, which
  // is the defect this script exists to avoid. So: both ids, and when a page is
  // over the 0.1 bound with neither producing items, every audit whose id looks
  // related is listed with what it DID produce, rather than printing silence
  // and leaving the next reader to guess.
  const shifts = median.audits?.['layout-shifts']?.details?.items
    ?? median.audits?.['cls-culprits-insight']?.details?.items
    ?? [];
  if (!shifts.length) {
    console.log('   layout-shifts / cls-culprits-insight: no items reported');
    if (num(median, 'cumulative-layout-shift') > 0.1) {
      console.log('   ⚠️  over the bound with no culprits — what the run did produce:');
      for (const [id, a] of Object.entries(median.audits ?? {})) {
        if (!/shift|layout|cls/i.test(id)) continue;
        const d = a.details;
        console.log(
          `     · ${id}: score ${a.score} mode ${a.scoreDisplayMode ?? '?'}` +
          ` details ${d ? `${d.type}/${(d.items ?? []).length} item(s)` : 'none'}`,
        );
        // ⚠️ Run 13 printed `layout-shifts: score null mode error details none`
        // and stopped there. `mode error` means the audit THREW, and the reason
        // is in errorMessage — the one field that says why the explanation is
        // missing, and the one the print-out left out. Same for the debugdata
        // the CLS audit itself carries, which run 13 reported as "1 item" and
        // did not show.
        if (a.errorMessage) console.log(`       errorMessage: ${a.errorMessage}`);
        for (const item of (d?.items ?? []).slice(0, 3)) {
          console.log(`       ${JSON.stringify(item).slice(0, 600)}`);
        }
      }
    }
  } else {
    console.log('   what shifted:');
    for (const item of shifts.slice(0, 5)) {
      const score = item.score ?? item.cumulativeLayoutShiftMainFrame ?? '';
      const causes = (item.subItems?.items ?? [])
        .map((s) => s.cause ?? s.extra?.value ?? '')
        .filter(Boolean)
        .join('; ');
      const node = item.node?.nodeLabel ?? item.node?.selector ?? '';
      console.log(`     · ${typeof score === 'number' ? score.toFixed(4) : score} ${node} ${causes}`.trimEnd());
    }
  }
}
console.log('');
