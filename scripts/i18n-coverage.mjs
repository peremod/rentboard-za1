#!/usr/bin/env node
/**
 * Translation coverage.
 *
 * Answers one question honestly: how much of what a visitor reads is actually
 * translatable, and where the untranslated copy lives.
 *
 *   node scripts/i18n-coverage.mjs            # summary
 *   node scripts/i18n-coverage.mjs --detail   # every string, grouped by file
 *   node scripts/i18n-coverage.mjs --top 10   # the files worth doing first
 *
 * Counts literal text nodes in component templates. A node is "covered" when
 * it goes through the translate pipe, and untranslated otherwise. The count is
 * approximate — it cannot see text built in TypeScript, and it will flag the
 * odd symbol — but the ratio is the point, and the ratio is not close.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const APP = join(ROOT, 'frontend/src/app');

const detail = process.argv.includes('--detail');
const topN = process.argv.includes('--top')
  ? Number(process.argv[process.argv.indexOf('--top') + 1]) || 10
  : 0;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** Text that is not really copy: symbols, numbers, single letters. */
const isCopy = (t) => /[A-Za-z]{3,}/.test(t) && !/^\s*[{}\[\]()<>|/\\.,;:—–-]+\s*$/.test(t);

const files = [];

for (const path of walk(APP)) {
  const src = readFileSync(path, 'utf8');
  const tpl = src.match(/template:\s*`([\s\S]*?)`,\n/);
  if (!tpl) continue;

  let body = tpl[1].replace(/<!--[\s\S]*?-->/g, '');

  const untranslated = [];
  let covered = 0;

  // Text nodes between tags.
  for (const m of body.matchAll(/>([^<>]{2,})</g)) {
    const raw = m[1].trim();
    if (!raw || !isCopy(raw)) continue;

    if (raw.includes('| translate')) { covered++; continue; }
    // Pure interpolation of a value is not copy.
    if (/^\{\{[^}]*\}\}$/.test(raw)) continue;

    untranslated.push(raw.replace(/\s+/g, ' ').slice(0, 70));
  }

  // Attributes a visitor reads.
  for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
    for (const m of body.matchAll(new RegExp(`${attr}="([^"{]{3,})"`, 'g'))) {
      if (isCopy(m[1])) untranslated.push(`[${attr}] ${m[1].slice(0, 60)}`);
    }
  }

  if (untranslated.length || covered) {
    files.push({
      path: path.replace(APP + '/', ''),
      covered,
      untranslated,
    });
  }
}

const totalCovered = files.reduce((n, f) => n + f.covered, 0);
const totalUntranslated = files.reduce((n, f) => n + f.untranslated.length, 0);
const total = totalCovered + totalUntranslated;
const pct = total ? Math.round((totalCovered / total) * 100) : 0;

console.log('\n── Translation coverage ────────────────────────────────────');
console.log(`  ${totalCovered} of ${total} visible strings go through the translate pipe (${pct}%)`);
console.log(`  ${totalUntranslated} strings are hard-coded English\n`);

const ranked = [...files]
  .filter((f) => f.untranslated.length)
  .sort((a, b) => b.untranslated.length - a.untranslated.length);

if (topN) {
  console.log(`── The ${topN} files with the most untranslated copy ────────────`);
  ranked.slice(0, topN).forEach((f) => {
    console.log(`  ${String(f.untranslated.length).padStart(4)}  ${f.path}`);
  });
  console.log();
} else if (detail) {
  for (const f of ranked) {
    console.log(`\n── ${f.path} (${f.untranslated.length}) ──`);
    f.untranslated.forEach((t) => console.log(`     ${t}`));
  }
} else {
  console.log('── Worst offenders ─────────────────────────────────────────');
  ranked.slice(0, 8).forEach((f) => {
    console.log(`  ${String(f.untranslated.length).padStart(4)}  ${f.path}`);
  });
  console.log('\n  --detail for every string, --top N for a longer ranking\n');
}

// Deliberately does not exit non-zero. Full coverage is a translation project,
// not a build gate, and failing CI on it would only teach people to skip CI.
