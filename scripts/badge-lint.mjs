/**
 * No two badges that mean different things may look the same.
 *
 * 🔴 A room card can carry seven badges over its photo — Featured, New,
 * Available now / From a date, Reserved, Sublet, Verified — and they were
 * declared across TWO files in three visual languages. Two pairs collided:
 *
 *   .badge-new      background: var(--sage); color: var(--white)
 *   .badge-verified background: var(--sage); color: var(--white)
 *
 * "listed in the last few days" and "this landlord's identity has been
 * checked" are not remotely the same claim, and they rendered identically.
 * Same for .badge-featured and .badge-sublet, both solid gold: one is paid
 * placement, the other is a tenant letting a room in a place they rent.
 *
 * ⚠️ This is the shape `state-lint` already guards for `.state--*` — one
 * vocabulary, declared once — and badges had no such gate, so the two
 * halves of the vocabulary drifted apart in separate files without either
 * file being wrong on its own.
 *
 * Source-level and in pre-commit: it needs no build, no API and no browser.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const STYLES = ['frontend/src/styles/_spec.scss', 'frontend/src/styles/_responsive.scss',
  'frontend/src/styles/styles.scss'];
const APP = 'frontend/src/app';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `.badge-x{ … }` rule, flattened to the three properties that decide how it reads. */
const rules = new Map();
for (const file of STYLES) {
  const css = strip(readFileSync(file, 'utf8'));
  for (const m of css.matchAll(/\.(badge-[a-z0-9-]+)\s*\{([^}]*)\}/g)) {
    const [, name, body] = m;
    const pick = (prop) => {
      const hit = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))].pop();
      return hit ? hit[1].trim().replace(/\s+/g, ' ') : '';
    };
    const prev = rules.get(name) ?? { file: relative('.', file), bg: '', fg: '', border: '' };
    rules.set(name, {
      file: prev.file,
      bg: pick('background') || pick('background-color') || prev.bg,
      fg: pick('color') || prev.fg,
      border: pick('border') || pick('border-color') || prev.border,
    });
  }
}

/** Every `.badge-x` a template actually uses. */
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});
const used = new Set();
/**
 * ⚠️ Component-scoped rules count as rules.
 *
 * The first version of this gate read RULES from the three global
 * stylesheets and USAGE from the whole app, so four badges styled inside
 * their own component's `styles` block were reported as having none. A
 * check whose two halves look at different scopes reports the difference
 * between the scopes, not a defect — the same mistake as measuring hidden
 * elements for a layout gap.
 *
 * The COLLISION check below stays global on purpose: those are the badges
 * that appear together on one card. Two encapsulated badges in different
 * components never meet, so holding them to the same rule would be noise.
 */
const localRules = new Set();
for (const file of walk(APP)) {
  const src = strip(readFileSync(file, 'utf8'));
  for (const m of src.matchAll(/badge-([a-z0-9-]+)/g)) used.add(`badge-${m[1]}`);
  for (const m of src.matchAll(/\.(badge-[a-z0-9-]+)\s*\{/g)) localRules.add(m[1]);
  for (const m of src.matchAll(/\.(badge--[a-z0-9-]+)\s*\{/g)) localRules.add(m[1]);
}

console.log('\n── Badges: one vocabulary, no two alike ────────────────────');
console.log(`  ${rules.size} variant(s) declared, ${used.size} used in templates.`);

const problems = [];

for (const name of used) {
  if (!rules.has(name) && !localRules.has(name)) {
    problems.push(`.${name} is used in a template and has no rule, global or local`);
  }
}

/**
 * The collision check, by COLOUR rather than by text.
 *
 * ⚠️ The first version compared the declarations as strings, and would
 * have passed .badge-featured (`var(--gold)`) beside .badge-sublet
 * (`rgba(200,144,42,.9)`) — the same gold written two ways, which is
 * indistinguishable on a photo and textually unequal. A gate that only
 * catches the collisions somebody happened to write identically is
 * narrower than its claim, which is the fault this file exists to stop.
 *
 * Tokens are resolved from :root, rgba is composited over white (badges
 * sit on a photo or a card, never on something dark), and two badges are
 * "alike" when both their fill and their text land within a small
 * distance of each other.
 */
const root = strip(readFileSync(STYLES[0], 'utf8'));
const tokens = new Map(
  [...root.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})/g)].map((m) => [m[1], m[2]]),
);

const hexToRgb = (h) => {
  let x = h.replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};

/** A declaration to [r,g,b] as it will actually appear, or null if unreadable. */
const toRgb = (decl) => {
  if (!decl) return null;
  let v = decl.trim();
  const varMatch = v.match(/var\((--[a-z0-9-]+)/);
  if (varMatch) v = tokens.get(varMatch[1]) ?? '';
  if (/^#[0-9A-Fa-f]{3,8}$/.test(v)) return hexToRgb(v);
  const rgba = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (rgba) {
    const [r, g, b] = [1, 2, 3].map((i) => Number(rgba[i]));
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    // Composited over white: a badge never sits on a dark surface here.
    return [r, g, b].map((c) => Math.round(c * a + 255 * (1 - a)));
  }
  return null;
};

const dist = (a, b) => (a && b
  ? Math.sqrt(a.reduce((acc, c, i) => acc + (c - b[i]) ** 2, 0))
  : Infinity);

/**
 * sRGB distance, applied to the fill AND the text: a badge is telling them
 * apart if EITHER differs clearly. Chosen from the measured spread rather
 * than tuned to a result — the pairs that genuinely differ sit at 48 and
 * 108 on text, the two that collide sit at 0, and the closest honest pair
 * (now vs later: fill 14, text 108) clears it on text alone.
 */
const ALIKE = 32;

const list = [...rules.entries()];
for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    const [an, a] = list[i];
    const [bn, b] = list[j];
    const bgA = toRgb(a.bg); const bgB = toRgb(b.bg);
    const fgA = toRgb(a.fg); const fgB = toRgb(b.fg);
    if (bgA === null || bgB === null) continue;   // unreadable: say nothing rather than guess
    const dBg = dist(bgA, bgB);
    const dFg = fgA && fgB ? dist(fgA, fgB) : 0;
    if (dBg <= ALIKE && dFg <= ALIKE) {
      problems.push(
        `.${an} and .${bn} read as the same badge — fill distance ${dBg.toFixed(0)}, `
        + `text distance ${dFg.toFixed(0)} (${a.bg || 'none'} vs ${b.bg || 'none'})`,
      );
    }
  }
}

if (problems.length) {
  console.log(`  ❌ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`     ${p}`);
  console.log('\n     A badge is a claim. Two claims that render the same are');
  console.log('     one claim as far as anybody reading the board is concerned.');
  console.log('════════════════════════════════════════════════════════════');
  process.exit(1);
}
console.log('  ✅ every badge used has a rule, and no two render alike.');
console.log('════════════════════════════════════════════════════════════');
