/**
 * Emoji used as an icon — a ratcheting baseline.
 *
 * ⚠️ Emoji are not an icon set. They are full-colour glyphs drawn by the
 * device: a different picture on a Samsung, a Pixel and an iPhone, at a
 * different optical weight each, with no way to size, align or recolour
 * them. A column of them down a sidebar was the loudest "assembled
 * quickly" signal this product had, and it was reported as exactly that.
 *
 * ⚠️ The whole FILE is scanned, not just the template literal, because the
 * board went on rendering a house emoji twelve times after every emoji in
 * the markup had been replaced: the glyph lived in a label map in the
 * class — `shared_house: '🏠 Shared house'` — where a sweep of the markup
 * cannot see it. A check that looks only where the author expected to find
 * something is the family this repo keeps producing.
 *
 * Comments are excluded, and deliberately: this codebase marks its own
 * hazards with ⚠️ and 🔴 in prose, by convention, and those are not
 * rendered by anything.
 *
 * A BASELINE rather than a ban, for the same reason token-lint has one:
 * 186 emoji across 47 templates cannot go in one change, and a gate that
 * is red for a fortnight is a gate everybody learns to ignore. The number
 * may go DOWN and never up.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = 'frontend/src/app';
const BASELINE = 'scripts/emoji-baseline.json';

/**
 * ⚠️ The ranges, and the three deliberate exclusions.
 *
 *   · U+FE0F (variation selector) is not a glyph, it is a modifier — and
 *     counting it doubled every count in the first version of this file.
 *   · Regional indicators (🇿🇦) are a national FLAG. A flag is not an icon
 *     and no stroke set contains one; the hero's South African flag stays.
 *   · ← → ↗ ↪ ✓ ✕ are typographic characters in running text, not icons,
 *     and `mobile-drive` asserts on the words "← Back to your dashboard".
 *     They are left to a later pass rather than silently swept up here.
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const FLAG = /[\u{1F1E6}-\u{1F1FF}]/gu;

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

const counts = {};
for (const file of walk(ROOT)) {
  const body = stripComments(readFileSync(file, 'utf8')).replace(FLAG, '');
  const n = (body.match(EMOJI) || []).length;
  if (n) counts[relative(ROOT, file)] = n;
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log('\n── Emoji used as an icon ───────────────────────────────────');
console.log(`  ${total} occurrence(s) across ${Object.keys(counts).length} file(s).`);

if (process.argv.includes('--write') || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`  📌 baseline written: ${BASELINE}`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const worse = [];
for (const [file, n] of Object.entries(counts)) {
  const was = base[file] ?? 0;
  if (n > was) worse.push(`${file}  ${was} → ${n}`);
}
const improved = Object.entries(base)
  .filter(([f, was]) => (counts[f] ?? 0) < was).length;

if (worse.length) {
  console.log(`  ❌ ${worse.length} file(s) gained emoji:`);
  for (const w of worse) console.log(`     ${w}`);
  console.log('\n     Use <app-icon name="…"/>. The set is in');
  console.log('     shared/components/icon/icon.ts and an unknown name warns');
  console.log('     in the console rather than rendering nothing silently.');
  console.log('     If the glyph is genuinely not an icon — a flag, a piece of');
  console.log('     running punctuation — say so in a comment beside it.');
  console.log('════════════════════════════════════════════════════════════');
  process.exit(1);
}

const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
console.log(`  ✅ nothing gained emoji; ${improved} file(s) improved since the baseline`);
console.log(`     (${baseTotal} baselined, ${total} now — run with --write to ratchet it down)`);
console.log('════════════════════════════════════════════════════════════');
