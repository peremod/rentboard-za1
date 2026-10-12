/**
 * Reading CSS values out of this codebase — the half-dozen primitives that
 * both the design-handoff count and the token gate need.
 *
 * It exists because there are two consumers and one truth. `tokens.mjs`
 * MEASURES what the styling actually uses; `scripts/token-lint.mjs` FAILS the
 * build on a literal that duplicates a token. If the two disagree about what
 * counts as a declaration, what counts as a comment, or what "nearly the same
 * colour" means, the gate reads green over values the report is listing as
 * debt — and the only way to notice is to compare two outputs by eye, which
 * nobody does.
 *
 * ⚠️ Why the colour maths is CIE Lab and not hex distance: #6B6B6B and
 * #6B6B70 differ by 5 in one channel and are indistinguishable; #0000FF and
 * #0000FA differ by 5 too and are not the point. ΔE below 3 is "a careful eye
 * in good light, side by side"; below 2 is "nobody, ever".
 */

/**
 * Blank out comments, PRESERVING OFFSETS, so a match index still maps to the
 * line it was written on. Handles `//`, `/* *\/` and both inside a .ts file.
 *
 * Offsets are the whole reason this returns a same-length string rather than
 * stripped source: the gate has to name file:line or nobody can act on it.
 */
export function stripComments(src) {
  const out = src.split('');
  let i = 0,
    str = null;
  while (i < src.length) {
    const c = src[i],
      n = src[i + 1];
    if (str) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      str = c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
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

/**
 * The byte ranges of a named decorator literal within a component's source —
 * `styles` or `template`.
 *
 * Generalised from `componentCssRanges`, which was the `styles` case, because
 * `css-coverage-audit` needs the TEMPLATE range for the same reason: a class
 * name shown as example markup in a doc comment is not a class the component
 * uses, and telling the two apart means knowing where the literal is.
 */
export function literalRanges(src, key) {
  const ranges = [];
  const re = new RegExp(`\\b${key}\\s*:\\s*(\\[|\`)`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1;
    const arr = src[i] === '[';
    if (arr) i++;
    let guard = 0;
    while (guard++ < 50) {
      const tick = src.indexOf('`', i);
      if (tick === -1) break;
      let j = tick + 1;
      while (j < src.length && !(src[j] === '`' && src[j - 1] !== '\\')) j++;
      ranges.push([tick + 1, j]);
      i = j + 1;
      if (!arr) break;
      const next = src.slice(i).match(/^\s*([,\]])/);
      if (!next || next[1] === ']') break;
    }
  }
  return ranges;
}

/** Blank HTML comments inside a slice, preserving offsets. */
export function blankHtmlComments(slice) {
  const out = slice.split('');
  let i = 0;
  while (i < slice.length) {
    if (slice.startsWith('<!--', i)) {
      const end = slice.indexOf('-->', i + 4);
      const stop = end === -1 ? slice.length : end + 3;
      for (; i < stop; i++) if (slice[i] !== '\n') out[i] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * A component's source with everything that is NOT on screen blanked, offsets
 * preserved: JSDoc and `//` comments, and HTML comments inside the template.
 *
 * ⚠️ `css-coverage-audit` read the raw source and so counted class names shown
 * as example markup in a doc comment as real usages. Phase J2's error-state
 * component documents the three screens it replaced —
 * `<p class="notices-empty" role="alert">` and two more — and the audit
 * reported all three, plus `.link-button`, as classes used in a template and
 * styled nowhere. Four false positives from one explanatory comment, in the
 * gate whose whole job is to be trustworthy about missing rules.
 */
export function onScreenSource(src) {
  let out = stripComments(src);
  for (const [a, b] of literalRanges(src, 'template')) {
    out = out.slice(0, a) + blankHtmlComments(src.slice(a, b)) + out.slice(b);
  }
  return out;
}

/**
 * The byte ranges of a component's `styles:` literal(s) within its own source.
 *
 * Ranges rather than the concatenated CSS, because the caller needs to know
 * WHERE. Half this app's styling lives in inline `styles:` blocks, so a tool
 * that only reads .scss files sees roughly half the truth.
 */
export function componentCssRanges(src) {
  const ranges = [];
  const re = /\bstyles\s*:\s*(\[|`)/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1;
    const arr = src[i] === '[';
    if (arr) i++;
    let guard = 0;
    while (guard++ < 50) {
      const tick = src.indexOf('`', i);
      if (tick === -1) break;
      let j = tick + 1;
      while (j < src.length && !(src[j] === '`' && src[j - 1] !== '\\')) j++;
      ranges.push([tick + 1, j]);
      i = j + 1;
      if (!arr) break;
      const next = src.slice(i).match(/^\s*([,\]])/);
      if (!next || next[1] === ']') break;
    }
  }
  return ranges;
}

/** Just the CSS out of a component .ts — its `styles:` literal(s). */
export function componentCss(src) {
  return componentCssRanges(src)
    .map(([a, b]) => '\n' + src.slice(a, b))
    .join('');
}

/**
 * Blank CSS comments inside a slice, preserving offsets.
 *
 * ⚠️ Needed because `stripComments` CANNOT see them when they are inside a
 * component's inline `styles:` block. That block is a template literal, so the
 * moment the backtick opens, `stripComments` is in string state and leaves
 * everything to the closing backtick alone — correctly, for a string. The
 * design-handoff count never noticed because it EXTRACTS the CSS first and
 * strips the extract, where no backtick remains.
 *
 * Anything reading the .ts in place, by offset, has to blank them separately,
 * and the first version of the token gate did not: it rewrote `#fff` inside
 * screen-hint's comment explaining why that very declaration exists, turning
 * the record of a 1.00:1 contrast bug into nonsense. One wrong edit in 57,
 * invisible to tsc and to `ng build`.
 */
export function blankCssComments(slice) {
  const out = slice.split('');
  let i = 0,
    str = null;
  while (i < slice.length) {
    const c = slice[i],
      n = slice[i + 1];
    if (str) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      str = c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < slice.length && slice[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      const end = slice.indexOf('*/', i + 2);
      const stop = end === -1 ? slice.length : end + 2;
      for (; i < stop; i++) if (slice[i] !== '\n') out[i] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * One styling source, ready to read BY OFFSET: comments blanked everywhere
 * (including inside inline `styles:` blocks), and the ranges that are actually
 * CSS. For a .scss file that is the whole file; for a component .ts it is its
 * `styles:` literal(s) and nothing else, so a hex in a template's `style="…"`
 * attribute or in TypeScript is not mistaken for a stylesheet declaration.
 *
 * Returns null when a .ts file carries no styles at all.
 */
export function cssSource(file, src) {
  if (file.endsWith('.scss') || file.endsWith('.css')) {
    return { css: stripComments(src), ranges: [[0, src.length]] };
  }
  const ranges = componentCssRanges(src);
  if (!ranges.length) return null;
  let css = stripComments(src);
  for (const [a, b] of ranges) {
    css = css.slice(0, a) + blankCssComments(src.slice(a, b)) + css.slice(b);
  }
  return { css, ranges };
}

export const hex2rgb = (h) => {
  let x = h.replace('#', '');
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  if (x.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};

export const lab = (rgb) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb.map(f);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * k(Y) - 16, 500 * (k(X) - k(Y)), 200 * (k(Y) - k(Z))];
};

export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** ΔE straight from two hex strings, or null if either will not parse. */
export function hexDeltaE(a, b) {
  const x = hex2rgb(a),
    y = hex2rgb(b);
  return x && y ? deltaE(lab(x), lab(y)) : null;
}

/**
 * Below this, two colours are the same colour as far as a person is concerned,
 * so a literal within it of a defined token is a bypass of the design system
 * rather than a deliberate choice. Shared so the report and the gate cannot
 * drift apart.
 */
export const SAME_COLOUR_DELTA_E = 3;

/** 1-based line number of a byte offset. */
export const lineAt = (src, index) => src.slice(0, index).split('\n').length;
