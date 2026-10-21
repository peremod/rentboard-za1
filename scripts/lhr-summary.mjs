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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.lighthouseci';

let files;
try {
  files = readdirSync(dir).filter((f) => f.startsWith('lhr-') && f.endsWith('.json'));
} catch {
  console.log(`no ${dir}/ directory — nothing collected, so nothing to summarise`);
  process.exit(0);
}
if (!files.length) {
  console.log(`${dir}/ holds no lhr-*.json — nothing to summarise`);
  process.exit(0);
}

const byUrl = new Map();
for (const f of files) {
  const lhr = JSON.parse(readFileSync(join(dir, f), 'utf8'));
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

  const lcpEl = median.audits?.['largest-contentful-paint-element']?.details?.items ?? [];
  for (const item of lcpEl.slice(0, 1)) {
    const node = item.items?.[0]?.node ?? item.node;
    if (node) console.log(`   LCP element: ${node.nodeLabel ?? ''} ${node.selector ?? ''}`.trim());
  }

  // The point of the whole script.
  const shifts = median.audits?.['layout-shifts']?.details?.items ?? [];
  if (!shifts.length) {
    console.log('   layout-shifts: no items reported');
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
