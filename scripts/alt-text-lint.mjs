#!/usr/bin/env node
/**
 * Every `<img>` in a template carries alt text, or says it is decorative.
 *
 * ── Why a source lint and not a rendered sweep
 *
 * axe already reports `image-alt`, and `scripts/a11y-widths.sh` runs it over
 * 33 pages at four widths. That sounds like coverage and is not, for a reason
 * that has nothing to do with axe: **an image only reaches the DOM if
 * something put it there.** The ad slot renders an image only when a campaign
 * is live, the storefront logo only when a provider uploaded one, the room
 * gallery only for a room with photos, the admin creative preview only after
 * a file is chosen. A sweep sees the images the seed data happens to produce
 * on the routes the sweep happens to visit, and silently says nothing about
 * the rest.
 *
 * Lighthouse is narrower still: `lighthouserc.json` names four URLs, so it
 * speaks for four of this application's fifty-odd pages.
 *
 * Reading the source has the opposite property. Every `<img>` a developer can
 * write is in a template whether or not any fixture reaches it, so this covers
 * the branches no seeded database will ever render. The two checks are
 * complements: axe knows what the alt text actually resolves to at runtime,
 * which a source lint cannot; this one knows every img exists at all, which a
 * sweep cannot.
 *
 * ── What counts as passing
 *
 * `alt="…"`, `[alt]="expr"` or `attr.alt` — present, in any form. A bound alt
 * is accepted without judging the expression: whether `[alt]="r.title"` is
 * *good* alt text is a question about the data, and a lint that guessed would
 * be the kind of check that fails for the wrong reason.
 *
 * `alt=""` PASSES, deliberately. An empty alt is the correct, specified way to
 * mark an image decorative (WCAG 1.1.1, and the H67 technique), and this
 * codebase uses it properly: the room card's hero and the property picker's
 * thumbnail are both adjacent to the same text they would otherwise repeat.
 * Flagging it would push somebody toward inventing alt text for an image a
 * screen reader is better off skipping — which is worse than no rule at all.
 *
 * What fails is an `<img>` with NO alt in any form. That is the one case where
 * a screen reader is left to read the file name aloud.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'frontend', 'src');

const walk = (d) =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/**
 * ⚠️ Comments are stripped first, and the first version of this script did
 * not do it.
 *
 * `imagekit.utils.ts` carries the line "for plain <img [src]> contexts only"
 * inside a doc comment. That is prose about images, not an image, and it was
 * reported as an `<img>` with no alt — a finding in a file that renders
 * nothing. A lint whose first run reports a false positive is a lint people
 * stop reading.
 *
 * Block comments go wholesale. Line comments only where the line STARTS with
 * `//` or `*`, so a `https://…` inside real markup survives.
 *
 * ⚠️ Comments are BLANKED, not removed, and that distinction is the whole
 * reason this is a named function. Deleting them shifts every line after the
 * comment, so the first falsification of this script reported a real missing
 * alt at line 82 when it was on line 93 — eleven lines adrift, in a file with
 * three `<img>` tags. A finding that points at the wrong line sends the reader
 * to the wrong place and teaches them not to trust the next one. Blanking
 * keeps every newline, so an offset into this string is an offset into the
 * file.
 */
const blankComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n');

const files = walk(APP).filter((f) => /\.(ts|html)$/.test(f));
const findings = [];
let imgs = 0;
let decorative = 0;
let scanned = 0;

for (const file of files) {
  const src = blankComments(readFileSync(file, 'utf8'));
  if (!src.includes('<img')) continue;
  scanned++;

  // Each <img …> up to its closing bracket. Angular templates self-close, but
  // `>` is accepted too so a plain-HTML file is read the same way.
  for (const m of src.matchAll(/<img\b([^>]*)>/g)) {
    imgs++;
    const attrs = m[1];
    const hasAlt = /(^|\s)(\[?attr\.alt\]?|\[alt\]|alt)\s*=/.test(attrs);
    if (!hasAlt) {
      const line = src.slice(0, m.index).split('\n').length;
      findings.push({
        file: relative(ROOT, file),
        line,
        snippet: m[0].replace(/\s+/g, ' ').slice(0, 88),
      });
      continue;
    }
    if (/(^|\s)alt\s*=\s*""/.test(attrs) || /\[alt\]\s*=\s*"''"/.test(attrs)) decorative++;
  }
}

console.log('\n\u001b[1m── Image alt text ──────────────────────────────────────────\u001b[0m');
console.log(`  ${imgs} <img> tag(s) across ${scanned} file(s).`);
console.log(`  ${decorative} marked decorative with an empty alt, which passes — see the note in this file.`);

if (findings.length === 0) {
  console.log('  \u001b[32m✅ every <img> declares alt text or declares itself decorative.\u001b[0m');
  console.log('\u001b[90m════════════════════════════════════════════════════════════\u001b[0m\n');
  process.exit(0);
}

for (const f of findings) {
  console.log(`  \u001b[31m❌\u001b[0m ${f.file}:${f.line}`);
  console.log(`     ${f.snippet}`);
}
console.log(
  `\n  \u001b[31m${findings.length} <img> tag(s) with no alt in any form.\u001b[0m\n` +
    '  Add alt="…" for an image that carries meaning, or alt="" for one that\n' +
    '  repeats adjacent text or is purely decorative. Both pass; neither is\n' +
    '  the same as leaving it out, which makes a screen reader read the file\n' +
    '  name aloud.',
);
console.log('\u001b[90m════════════════════════════════════════════════════════════\u001b[0m\n');
process.exit(1);
