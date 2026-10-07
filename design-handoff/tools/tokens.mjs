/**
 * Every design value ACTUALLY in use, counted — Mastande design handoff.
 *
 * ⚠️ This reads what is there, not what was intended. `_variables.scss` is the
 * spec; this is the evidence. The gap between them is the point of the
 * exercise — three near-identical greys used interchangeably does not show up
 * in a spec, only in a count.
 *
 *   node design-handoff/tools/tokens.mjs           # JSON
 *   node design-handoff/tools/tokens.mjs --md      # the markdown tables
 *
 * Sources, both of them, because half this app's styling is in component
 * `styles:` blocks that no stylesheet audit would ever see:
 *   · frontend/src/styles/*.scss
 *   · the inline `styles:`/`styleUrl` of every component .ts
 *
 * Counting rules worth knowing before reading the numbers:
 *   · A declaration inside a @media block counts once, where it is written.
 *     A value used at three breakpoints is three uses, which is honest —
 *     it is three places to change.
 *   · SCSS variable DEFINITIONS are excluded from the count and listed
 *     separately, or every token would score one free use for existing.
 *   · Values inside comments are excluded; the comments here are long and
 *     quote hex codes constantly.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STYLES = 'frontend/src/styles';
const APP = 'frontend/src/app';

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Blank out comments, preserving offsets. Both // and /* *\/ and SCSS //. */
function stripComments(src) {
  const out = src.split('');
  let i = 0, str = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Just the CSS out of a component .ts — its `styles:` literal(s). */
function componentCss(src) {
  let css = '';
  const re = /\bstyles\s*:\s*(\[|`)/g;
  let m;
  while ((m = re.exec(src))) {
    // Walk forward collecting every template literal until the array closes.
    let i = m.index + m[0].length - 1;
    const arr = src[i] === '[';
    if (arr) i++;
    let guard = 0;
    while (guard++ < 50) {
      const tick = src.indexOf('`', i);
      if (tick === -1) break;
      let j = tick + 1;
      while (j < src.length && !(src[j] === '`' && src[j - 1] !== '\\')) j++;
      css += '\n' + src.slice(tick + 1, j);
      i = j + 1;
      if (!arr) break;
      const next = src.slice(i).match(/^\s*([,\]])/);
      if (!next || next[1] === ']') break;
    }
  }
  return css;
}

const files = [];
for (const f of walk(STYLES)) if (f.endsWith('.scss')) files.push({ f, css: readFileSync(f, 'utf8'), kind: 'scss' });
for (const f of walk(APP)) {
  if (!f.endsWith('.ts') || f.endsWith('.spec.ts')) continue;
  const src = readFileSync(f, 'utf8');
  if (!/\bstyles\s*:/.test(src)) continue;
  const css = componentCss(src);
  if (css.trim()) files.push({ f, css, kind: 'component' });
}

const buckets = {
  colour: new Map(), fontFamily: new Map(), fontSize: new Map(), fontWeight: new Map(),
  spacing: new Map(), radius: new Map(), shadow: new Map(),
  /**
   * ⚠️ The two numbers that make the colour count readable.
   *
   * `tokenRef` counts `var(--slate)` and friends — the design system being
   * USED. `colour` counts literal hex/rgb/hsl — the system being BYPASSED.
   * Without the split, a raw #FFF scoring 52 looks like the dominant colour in
   * the app when var(--white) is used 22 times and var(--slate) 104; and the
   * 166 "distinct colours" reads as chaos rather than as 25 tokens plus a long
   * tail of one-off literals. The tail is the finding. The split is what makes
   * it legible.
   */
  tokenRef: new Map(),
  tokenDef: new Map(),
};
const add = (b, value, file) => {
  if (!buckets[b].has(value)) buckets[b].set(value, { count: 0, files: new Set() });
  const e = buckets[b].get(value);
  e.count++; e.files.add(file);
};

/** SCSS variable definitions, listed but not counted as usage. */
const defs = new Map();

for (const { f, css: raw, kind } of files) {
  const css = stripComments(raw);

  for (const m of css.matchAll(/^\s*(\$[\w-]+)\s*:\s*([^;]+);/gm)) {
    defs.set(m[1], { value: m[2].trim(), file: f });
  }
  // Everything below reads DECLARATIONS only, so a value in a selector name or
  // a variable definition is not mistaken for a use.
  const decls = [...css.matchAll(/([-\w]+)\s*:\s*([^;{}]+)[;}]/g)]
    .filter((m) => !m[1].startsWith('$'));

  for (const [, prop, rawVal] of decls) {
    const val = rawVal.trim();
    if (!val || val.startsWith('$') === false && /^\s*$/.test(val)) continue;

    // Every var(--x) reference — the system being used.
    for (const t of val.matchAll(/var\(\s*(--[\w-]+)/g)) add('tokenRef', t[1], f);

    // A custom-property DEFINITION is the token itself, not a use of a colour.
    // Counting `--slate: #6B6B6B` as a raw colour use would credit the system
    // with the very bypass it exists to prevent.
    if (prop.startsWith('--')) {
      add('tokenDef', `${prop}: ${val}`, f);
      continue;
    }

    // ── Colour: hex, rgb(a), hsl(a) — wherever it appears in the value ──
    for (const c of val.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) add('colour', c[0].toUpperCase(), f);
    for (const c of val.matchAll(/\brgba?\([^)]*\)/g)) add('colour', c[0].replace(/\s+/g, ' '), f);
    for (const c of val.matchAll(/\bhsla?\([^)]*\)/g)) add('colour', c[0].replace(/\s+/g, ' '), f);

    if (/^font-family$/.test(prop)) add('fontFamily', val.replace(/\s+/g, ' '), f);
    if (/^font-size$/.test(prop)) add('fontSize', val, f);
    if (/^font-weight$/.test(prop)) add('fontWeight', val, f);
    if (/^(border-)?radius$|^border-radius$/.test(prop)) add('radius', val, f);
    if (/^box-shadow$|^text-shadow$/.test(prop)) add('shadow', val.replace(/\s+/g, ' '), f);

    // ── Spacing: the properties that actually create rhythm ──
    if (/^(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline|start|end))?$/.test(prop)) {
      for (const n of val.matchAll(/(-?[\d.]+)(rem|px|em|%)/g)) add('spacing', n[0], f);
    }
    // The `font` shorthand carries a size; it is a real use.
    if (prop === 'font') for (const n of val.matchAll(/(^|\s)([\d.]+(rem|px|em))/g)) add('fontSize', n[2], f);
  }
}

/**
 * Colours close enough that nobody could tell them apart on a phone — the
 * thing a spec can never show you.
 *
 * ⚠️ Compared in CIE Lab via a plain sRGB→XYZ→Lab conversion, not by hex
 * distance. #6B6B6B and #6B6B70 differ by 5 in one channel and are
 * indistinguishable; #0000FF and #0000FA differ by 5 too and are not the
 * point. Hex distance flags the wrong pairs. ΔE below 3 is "a careful eye in
 * good light, side by side"; below 2 is "nobody, ever".
 */
const hex2rgb = (h) => {
  let x = h.replace('#', '');
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  if (x.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
const lab = (rgb) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(f);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * k(Y) - 16, 500 * (k(X) - k(Y)), 200 * (k(Y) - k(Z))];
};
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function nearDuplicates(colourRows, tokenDefRows) {
  // Token definitions join the comparison: a literal sitting 1.2 ΔE from a
  // token the system already defines is the clearest possible finding.
  const pts = [];
  for (const r of colourRows) {
    const rgb = r.value.startsWith('#') ? hex2rgb(r.value) : null;
    if (rgb) pts.push({ label: r.value, count: r.count, lab: lab(rgb), source: 'literal' });
  }
  for (const r of tokenDefRows) {
    const m = r.value.match(/^(--[\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/);
    if (!m) continue;
    const rgb = hex2rgb(m[2]);
    if (rgb) pts.push({ label: `${m[1]} (${m[2].toUpperCase()})`, count: r.count, lab: lab(rgb), source: 'token' });
  }
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    const group = [pts[i]];
    for (let j = i + 1; j < pts.length; j++) {
      if (used.has(j)) continue;
      if (deltaE(pts[i].lab, pts[j].lab) < 3) { group.push(pts[j]); used.add(j); }
    }
    if (group.length > 1) { used.add(i); clusters.push(group); }
  }
  return clusters
    .map((g) => ({
      members: g.map(({ label, count, source }) => ({ label, count, source })),
      totalUses: g.reduce((a, b) => a + b.count, 0),
      maxDeltaE: Math.max(...g.flatMap((a, x) => g.slice(x + 1).map((b) => deltaE(a.lab, b.lab)))).toFixed(2),
    }))
    .sort((a, b) => b.totalUses - a.totalUses);
}

const out = {};
for (const [name, map] of Object.entries(buckets)) {
  out[name] = [...map.entries()]
    .map(([value, e]) => ({ value, count: e.count, files: e.files.size, where: [...e.files].slice(0, 4) }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
out.nearDuplicateColours = nearDuplicates(
  [...buckets.colour.entries()].map(([value, e]) => ({ value, count: e.count })),
  [...buckets.tokenDef.entries()].map(([value, e]) => ({ value, count: e.count })),
);
out.variableDefinitions = [...defs.entries()].map(([name, d]) => ({ name, ...d }));
out.scanned = { files: files.length, scss: files.filter((x) => x.kind === 'scss').length,
                components: files.filter((x) => x.kind === 'component').length };

if (process.argv.includes('--md')) {
  const table = (rows, head) => {
    console.log(`\n| ${head} | Uses | Files |`);
    console.log('|---|---:|---:|');
    for (const r of rows) console.log(`| \`${r.value}\` | ${r.count} | ${r.files} |`);
  };
  console.log('<!-- generated by design-handoff/tools/tokens.mjs -->');
  console.log(`\nScanned ${out.scanned.scss} stylesheets and ${out.scanned.components} components with inline styles.`);
  for (const [k, head] of [['tokenRef','Design token (var(--x))'],['colour','Literal colour (bypasses the tokens)'],
                           ['fontFamily','Font family'],['fontSize','Font size'],
                           ['fontWeight','Font weight'],['spacing','Spacing'],['radius','Border radius'],['shadow','Shadow']]) {
    console.log(`\n## ${head} — ${out[k].length} distinct value(s)`);
    table(out[k], head);
  }
} else {
  console.log(JSON.stringify(out, null, 2));
}
