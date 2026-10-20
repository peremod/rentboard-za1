/**
 * Every app-icon name resolves to a real icon.
 *
 * 🔴 This exists because of a specific failure, and the failure was mine.
 *
 * The icon set was expanded, the sidebars were migrated onto it, the drives
 * were run and the screenshots taken — all green. Then `emoji-lint` was
 * written, and falsifying it meant appending an emoji to `icon.ts` and
 * undoing that with `git checkout frontend/.../icon.ts`. The file had
 * UNCOMMITTED work in it, so the checkout did not undo the falsification:
 * it discarded the whole expansion, including the `filled` input. The
 * commit that followed did not compile.
 *
 * ⚠️ Nothing caught it, and every check that could have was pointed
 * elsewhere by then: the drives and the build had run BEFORE the revert,
 * the screenshots were of a tree that no longer existed, and `emoji-lint`
 * only counts glyphs. A verification that happened before the last change
 * is not a verification of what shipped.
 *
 * So: a source-only check, in pre-commit, that reads the icon map and every
 * `name="…"` a template hands it. It needs no build, no API and no browser,
 * and it would have failed in under a second.
 *
 * ⚠️ A DYNAMIC name — `[name]="item.icon"` or `[name]="roomTypeIcon()"` —
 * cannot be resolved here, and this does not pretend to. Those are listed
 * so the number is honest about what is unchecked; the nav definitions they
 * come from are checked separately below, because that is where the 38
 * sidebar names live.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = 'frontend/src/app';
const ICON_FILE = join(ROOT, 'shared/components/icon/icon.ts');

const known = new Set(
  [...readFileSync(ICON_FILE, 'utf8').matchAll(/^\s{2}'?([a-z][a-z-]*)'?:\s*\[/gm)].map((m) => m[1]),
);

const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

const bad = [];
let checked = 0;
let dynamic = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);

  // Static: <app-icon name="x"/>
  for (const m of src.matchAll(/<app-icon[^>]*\sname="([^"]+)"/g)) {
    checked++;
    if (!known.has(m[1])) bad.push(`${rel}  <app-icon name="${m[1]}"/>`);
  }
  // Dynamic: [name]="…" — counted, not resolved.
  dynamic += [...src.matchAll(/<app-icon[^>]*\s\[name\]=/g)].length;

  /**
   * ⚠️ The nav definitions, by name, because this is where the sidebars
   * get their icons and a wrong one there is a blank box on every portal
   * page rather than on one screen.
   */
  if (/-nav\.ts$/.test(file)) {
    for (const m of src.matchAll(/icon:\s*'([^']+)'/g)) {
      checked++;
      if (!known.has(m[1])) bad.push(`${rel}  icon: '${m[1]}'`);
    }
  }
}

console.log('\n── Icon names ──────────────────────────────────────────────');
console.log(`  ${known.size} icon(s) defined; ${checked} name(s) checked, ${dynamic} bound dynamically.`);

if (bad.length) {
  console.log(`  ❌ ${bad.length} name(s) do not exist in the set:`);
  for (const b of bad) console.log(`     ${b}`);
  console.log(`\n     Known: ${[...known].sort().join(', ')}`);
  console.log('════════════════════════════════════════════════════════════');
  process.exit(1);
}
console.log('  ✅ every app-icon name resolves to a shape in the set.');
console.log('════════════════════════════════════════════════════════════');
