# Design tokens — what is actually in use

**Measured, not specified.** `node design-handoff/tools/tokens.mjs --md`

`frontend/src/styles/_variables.scss` and `_spec.scss` are the *intent*. This
file is the *evidence*: every colour, font, spacing value, radius and shadow
found in a real CSS declaration, with a count of how many places uses it.

The two never match, and the gap is the brief.

**Scanned:** 5 stylesheets and **55 components with inline `styles:` blocks.**
That second number matters — roughly two-thirds of this app's styling lives
inside component files, where no stylesheet audit would ever look.

---

## The headline

| | Distinct values | Total uses | Before Phase H |
|---|---:|---:|---|
| **Design tokens** referenced as `var(--x)` | 33 | **775** | 671 |
| **Literal colours** written inline, bypassing the tokens | **149** | 258 | 158 / 330 |

**101 of those 149 literal colours are used exactly once.**

So the system is real and it is being used — 775 times, up from 671 because
**57 literals in 20 files were migrated onto tokens on 11 October**:
`#FFF`/`#FFFFFF` → `var(--white)` (which went from 22 uses to 59) and
`#DDD5C8` → `var(--border)` (131 → 145).

### ⚠️ Two numbers in the previous version of this file were wrong

`tokens.mjs` claimed in its own header that SCSS variable DEFINITIONS were
excluded from the count. They were not: the declaration pattern was
`([-\w]+)` with a `.filter(m => !m[1].startsWith('$'))` behind it, and
`[-\w]` does not match `$`, so on `$color-cream-2: #F2EDE3;` the match began
one character later and the filter could never fire. Twenty palette
definitions in `_variables.scss` were counted as literal colour USES. Fixed;
the pre-migration figures were 150 distinct / 314 uses, not 159 / 332.

### What was left behind

- **`#FFF` is still written 15 times** — 13 of them in `_spec.scss`, whose own
  header forbids hand-editing it (it is a verbatim port of the visual
  preview), and 2 in a `@media print` block where paper is paper and a token
  that could be redefined is the wrong currency.
- **`#F2EDE3` ×10 is exactly `--cream2`.** `#3A3228` ×9 is exactly `--ink2`.
  `#3D7040` ×7 is exactly `--sage`. These are not near-misses — they are the
  token's own value, retyped, and they are the next migration.

### What now stops it happening again

`scripts/token-lint.mjs`, in `npm run audit` and in CI. A literal hex within
ΔE 3 of a defined token fails the build; the 59 known uses are carried in
`scripts/token-baseline.json` as a ratcheting baseline keyed by file, value and
count, so a new file reaching for `#FFF` fails and so does a twentieth
`#DDD5C8` in a file that already had nineteen. It is debt, not permission.

It also asserts the thing this file could never see: a **`var(--x)` with no
fallback naming a token defined nowhere**. On its first run it found
`var(--line)` used 14 times across 9 components and defined nowhere — 14
borders that did not render at all, because an unresolved custom property makes
`border-style` fall back to `none`. See `docs/OUTSTANDING.md` § 40.

---

## Near-identical colours — 13 cluster(s)

Compared in CIE Lab (ΔE), not by hex distance: #6B6B6B and #6B6B70 differ by 5
in one channel and are indistinguishable, while #0000FF and #0000FA differ by 5
too and are not the point. **ΔE below 3** is "a careful eye, side by side, in
good light"; **below 2** is nobody, ever. Token definitions are included in the
comparison, because a literal sitting 1 ΔE from a token the system already
defines is the clearest finding there is.

| ΔE (max within cluster) | Total uses | Values
|---:|---:|---|
| 0.00 | 16 | `#FFF` ×15 · `--white (#FFFFFF)` ×1 _(token)_ |
| 0.00 | 11 | `#F2EDE3` ×10 · `--cream2 (#F2EDE3)` ×1 _(token)_ |
| 0.00 | 10 | `#3A3228` ×9 · `--ink2 (#3A3228)` ×1 _(token)_ |
| 0.00 | 8 | `#3D7040` ×7 · `--sage (#3D7040)` ×1 _(token)_ |
| 1.49 | 7 | `#FDFAF5` ×4 · `#FDFAF4` ×1 · `--cream (#FAF7F0)` ×1 _(token)_ · `--card (#FDFAF4)` ×1 _(token)_ |
| 2.57 | 6 | `#1A1410` ×4 · `#1C160E` ×1 · `--ink (#1C160E)` ×1 _(token)_ |
| 0.00 | 3 | `#E0D5C4` ×2 · `--border (#E0D5C4)` ×1 _(token)_ |
| 1.85 | 3 | `#5A5044` ×2 · `#5A5047` ×1 |
| 2.04 | 3 | `#FDF6EC` ×2 · `#FDF6E8` ×1 |
| 2.78 | 3 | `#F4F1EC` ×1 · `#F2F2F2` ×2 |
| 0.00 | 3 | `#AD4222` ×2 · `--terra (#AD4222)` ×1 _(token)_ |
| 0.72 | 2 | `#E8DECE` ×1 · `#E8DFD0` ×1 |
| 0.00 | 2 | `#8E3519` ×1 · `--terra-deep (#8E3519)` ×1 _(token)_ |

---

## Type, spacing and shape — the shape of the inconsistency

| Axis | Distinct values in use | Total uses | Read |
|---|---:|---:|---|
| Font family | 7 | 47 | ⚠️ **Two real faces, not three.** `--font-mono` named `'DM Mono'` and `index.html` has never requested it, so every money figure in this app rendered in Courier New. Corrected 11 October; `scripts/font-lint.mjs` now fails on a token naming a family nothing fetches — `docs/OUTSTANDING.md` § 47. |
| Font size | **49** | 436 | A nine-step scale would cover this. The top ten sizes are `.72`–`1rem`, eight values inside a 0.28rem band — `.78`, `.8`, `.82`, `.85`, `.88` all exist and all are used 25–55 times. ⚠️ **Ratcheted, not migrated** (Phase K): 28 off-scale values over 222 uses are baselined in `scripts/scale-baseline.json` and the drift is stopped — 436 declarations is churn with real visual risk and nothing reviewable. |
| Font weight | 5 | 170 | 700 (×72) and 600 (×55) do most of the work. Healthy. |
| Spacing | **60** | 1066 | The real rhythm is `.5rem`, `1rem`, `.75rem`, `1.5rem`. Around them sit `.6`, `.85`, `.9`, `.4`, `.3` — a second, unspoken half-step scale. ⚠️ **Ratcheted** (Phase J3): 39 off-scale values over 536 uses baselined. |
| Border radius | 15 | 174 | ✅ **Migrated 11 October (Phase J3).** Was 28 values: `8px` ×15 (which **is** `--r8`), `6px` ×13, `10px` ×10, `4px` ×6, `12px` ×3 and a tail of singles. Now only the tokens, `50%` for circles, `0` for square, the SCSS `$r*` layer and four one-side compounds. `scripts/scale-lint.mjs` holds it at zero tolerance. |
| Shadow | 11 | 32 | ✅ **Migrated 11 October (Phase K).** Was 18 definitions, and they were three KINDS of thing wearing one property: six focus RINGS (a spread with no blur, at 1px and 3px, four tints), four black overlay shadows where every token is ink-tinted, and a button lift — the lift tinted with `#C04E28`, the terracotta **retired for failing contrast**. Now four `--ring-*` tokens, `--shadow-lift`, and `--shadow-xl` for every overlay. `docs/OUTSTANDING.md` §§ 52–53. |

**The pattern is the same in every row:** a small, sound token set, used
correctly in most places, with a long tail of raw values that duplicate it.
Nobody chose the tail. It accumulated.

---
<!-- generated by design-handoff/tools/tokens.mjs -->

Scanned 5 stylesheets and 59 components with inline styles.

## Design token (var(--x)) — 42 distinct value(s)

| Design token (var(--x)) | Uses | Files |
|---|---:|---:|
| `--border` | 142 | 42 |
| `--slate` | 113 | 31 |
| `--terra` | 75 | 21 |
| `--r4` | 73 | 24 |
| `--white` | 72 | 22 |
| `--ink2` | 64 | 20 |
| `--ink` | 47 | 7 |
| `--cream2` | 40 | 14 |
| `--r8` | 40 | 21 |
| `--r-full` | 25 | 7 |
| `--sage` | 25 | 8 |
| `--r12` | 19 | 12 |
| `--card` | 16 | 9 |
| `--cream` | 14 | 3 |
| `--gold` | 14 | 8 |
| `--danger` | 11 | 9 |
| `--font-body` | 11 | 2 |
| `--font-mono` | 11 | 4 |
| `--font-display` | 9 | 5 |
| `--shadow-xl` | 8 | 7 |
| `--terra2` | 6 | 3 |
| `--sage-deep` | 4 | 3 |
| `--state-ink` | 4 | 1 |
| `--terra-deep` | 4 | 3 |
| `--gold-text` | 3 | 2 |
| `--r20` | 3 | 2 |
| `--ring-danger` | 2 | 2 |
| `--ring-terra` | 2 | 2 |
| `--shadow-lg` | 2 | 1 |
| `--shadow-lift` | 2 | 2 |
| `--shadow-sm` | 2 | 1 |
| `--accent` | 1 | 1 |
| `--gold2` | 1 | 1 |
| `--line` | 1 | 1 |
| `--logo-ma` | 1 | 1 |
| `--nav-height` | 1 | 1 |
| `--ring-gold` | 1 | 1 |
| `--ring-sage` | 1 | 1 |
| `--shadow-md` | 1 | 1 |
| `--state-fill` | 1 | 1 |
| `--surface2` | 1 | 1 |
| `--warn` | 1 | 1 |

## Literal colour (bypasses the tokens) — 133 distinct value(s)

| Literal colour (bypasses the tokens) | Uses | Files |
|---|---:|---:|
| `#F2EDE3` | 7 | 4 |
| `rgba(61,112,64,.1)` | 6 | 5 |
| `#000` | 4 | 2 |
| `#1A1410` | 4 | 4 |
| `#3A3228` | 4 | 2 |
| `#FDFAF5` | 4 | 3 |
| `rgba(250,247,240,.65)` | 4 | 1 |
| `rgba(61,112,64,.12)` | 4 | 1 |
| `#1E5FA8` | 3 | 2 |
| `rgba(173,66,34,.06)` | 3 | 2 |
| `rgba(250,247,240,.5)` | 3 | 1 |
| `rgba(250,247,240,.62)` | 3 | 1 |
| `rgba(61,112,64,.05)` | 3 | 1 |
| `#0F7A3D` | 2 | 2 |
| `#2F5632` | 2 | 1 |
| `#2F6B3A` | 2 | 2 |
| `#3D7040` | 2 | 2 |
| `#5A5044` | 2 | 2 |
| `#6B6055` | 2 | 1 |
| `#AD4222` | 2 | 1 |
| `#C9792B` | 2 | 2 |
| `#F2F2F2` | 2 | 1 |
| `#FDF6EC` | 2 | 2 |
| `#FFF` | 2 | 1 |
| `rgb(58, 50, 40)` | 2 | 1 |
| `rgba(173, 66, 34,.2)` | 2 | 1 |
| `rgba(173, 66, 34,.3)` | 2 | 1 |
| `rgba(200,144,42,.12)` | 2 | 1 |
| `rgba(214, 59, 59, .04)` | 2 | 2 |
| `rgba(214, 59, 59, .35)` | 2 | 2 |
| `rgba(250, 247, 240, .33)` | 2 | 1 |
| `rgba(250, 247, 240, 0)` | 2 | 1 |
| `rgba(250,247,240,.25)` | 2 | 1 |
| `rgba(250,247,240,.75)` | 2 | 1 |
| `rgba(255,255,255,.07)` | 2 | 1 |
| `rgba(255,255,255,.08)` | 2 | 2 |
| `rgba(26, 20, 16, .55)` | 2 | 2 |
| `rgba(30,95,168,.1)` | 2 | 1 |
| `rgba(37,211,102,.14)` | 2 | 2 |
| `rgba(58, 50, 40, 0)` | 2 | 1 |
| `rgba(61, 112, 64, .12)` | 2 | 2 |
| `rgba(61,112,64,.06)` | 2 | 2 |
| `rgba(61,112,64,.07)` | 2 | 1 |
| `rgba(61,112,64,.25)` | 2 | 2 |
| `#1C160E` | 1 | 1 |
| `#1F6F4A` | 1 | 1 |
| `#4A4034` | 1 | 1 |
| `#5A5047` | 1 | 1 |
| `#6B4710` | 1 | 1 |
| `#7A4A12` | 1 | 1 |
| `#7A5714` | 1 | 1 |
| `#886308` | 1 | 1 |
| `#8E3519` | 1 | 1 |
| `#B4541F` | 1 | 1 |
| `#BE3333` | 1 | 1 |
| `#C9B894` | 1 | 1 |
| `#D4A853` | 1 | 1 |
| `#D4C8B4` | 1 | 1 |
| `#D63B3B` | 1 | 1 |
| `#E3DED6` | 1 | 1 |
| `#E8D9BC` | 1 | 1 |
| `#E8DECE` | 1 | 1 |
| `#E8DFD0` | 1 | 1 |
| `#F4F1EC` | 1 | 1 |
| `#FDF6E8` | 1 | 1 |
| `#FDFAF4` | 1 | 1 |
| `rgba($color-danger, .07)` | 1 | 1 |
| `rgba($color-danger, .35)` | 1 | 1 |
| `rgba(0, 0, 0, .5)` | 1 | 1 |
| `rgba(0,0,0,.6)` | 1 | 1 |
| `rgba(10,8,6,.94)` | 1 | 1 |
| `rgba(115, 103, 85, .1)` | 1 | 1 |
| `rgba(115, 103, 85,.1)` | 1 | 1 |
| `rgba(173, 66, 34, .07)` | 1 | 1 |
| `rgba(173, 66, 34, .08)` | 1 | 1 |
| `rgba(173, 66, 34, .1)` | 1 | 1 |
| `rgba(173, 66, 34,.06)` | 1 | 1 |
| `rgba(173, 66, 34,.08)` | 1 | 1 |
| `rgba(173, 66, 34,.1)` | 1 | 1 |
| `rgba(173, 66, 34,.18)` | 1 | 1 |
| `rgba(173,66,34,.04)` | 1 | 1 |
| `rgba(173,66,34,.1)` | 1 | 1 |
| `rgba(173,66,34,.72)` | 1 | 1 |
| `rgba(178, 59, 59, .08)` | 1 | 1 |
| `rgba(178,59,59,.07)` | 1 | 1 |
| `rgba(178,59,59,.35)` | 1 | 1 |
| `rgba(178,59,59,.4)` | 1 | 1 |
| `rgba(184,134,11,.12)` | 1 | 1 |
| `rgba(200, 144, 42, .08)` | 1 | 1 |
| `rgba(200, 144, 42, .3)` | 1 | 1 |
| `rgba(200,144,42,.06)` | 1 | 1 |
| `rgba(200,144,42,.08)` | 1 | 1 |
| `rgba(200,144,42,.14)` | 1 | 1 |
| `rgba(200,144,42,.18)` | 1 | 1 |
| `rgba(200,144,42,.9)` | 1 | 1 |
| `rgba(201, 162, 39, .08)` | 1 | 1 |
| `rgba(212, 168, 83, .12)` | 1 | 1 |
| `rgba(212, 168, 83, .35)` | 1 | 1 |
| `rgba(214, 59, 59, .05)` | 1 | 1 |
| `rgba(214,154,59,.1)` | 1 | 1 |
| `rgba(214,154,59,.35)` | 1 | 1 |
| `rgba(214,59,59,.06)` | 1 | 1 |
| `rgba(250, 247, 240, .25)` | 1 | 1 |
| `rgba(250,247,240,.06)` | 1 | 1 |
| `rgba(250,247,240,.4)` | 1 | 1 |
| `rgba(250,247,240,.45)` | 1 | 1 |
| `rgba(250,247,240,.55)` | 1 | 1 |
| `rgba(250,247,240,.6)` | 1 | 1 |
| `rgba(255, 255, 255, .06)` | 1 | 1 |
| `rgba(255, 255, 255, .1)` | 1 | 1 |
| `rgba(255, 255, 255, .15)` | 1 | 1 |
| `rgba(255, 255, 255, .65)` | 1 | 1 |
| `rgba(255, 255, 255, .9)` | 1 | 1 |
| `rgba(255,255,255,.06)` | 1 | 1 |
| `rgba(255,255,255,.15)` | 1 | 1 |
| `rgba(255,255,255,.25)` | 1 | 1 |
| `rgba(255,255,255,.4)` | 1 | 1 |
| `rgba(255,255,255,.72)` | 1 | 1 |
| `rgba(255,255,255,.75)` | 1 | 1 |
| `rgba(255,255,255,.8)` | 1 | 1 |
| `rgba(255,255,255,.85)` | 1 | 1 |
| `rgba(255,255,255,.92)` | 1 | 1 |
| `rgba(26, 20, 16, 0.08)` | 1 | 1 |
| `rgba(26,20,16,.55)` | 1 | 1 |
| `rgba(26,20,16,.62)` | 1 | 1 |
| `rgba(28,22,14,.5)` | 1 | 1 |
| `rgba(30, 95, 168, .1)` | 1 | 1 |
| `rgba(58,50,40,.25)` | 1 | 1 |
| `rgba(61, 112, 64, .3)` | 1 | 1 |
| `rgba(61,112,64,.08)` | 1 | 1 |
| `rgba(61,112,64,.2)` | 1 | 1 |
| `rgba(61,112,64,.22)` | 1 | 1 |
| `rgba(61,112,64,.3)` | 1 | 1 |

## Font family — 7 distinct value(s)

| Font family | Uses | Files |
|---|---:|---:|
| `var(--font-body)` | 11 | 2 |
| `var(--font-mono)` | 11 | 4 |
| `var(--font-display)` | 9 | 5 |
| `$font-body` | 6 | 1 |
| `inherit` | 6 | 5 |
| `sans-serif` | 3 | 3 |
| `$font-display` | 1 | 1 |

## Font size — 49 distinct value(s)

| Font size | Uses | Files |
|---|---:|---:|
| `.85rem` | 56 | 20 |
| `.78rem` | 45 | 21 |
| `.82rem` | 37 | 17 |
| `.8rem` | 35 | 15 |
| `.75rem` | 25 | 12 |
| `.88rem` | 25 | 13 |
| `.72rem` | 24 | 10 |
| `.9rem` | 23 | 15 |
| `1rem` | 18 | 9 |
| `.95rem` | 11 | 11 |
| `0.8rem` | 9 | 6 |
| `1.25rem` | 8 | 5 |
| `.7rem` | 7 | 4 |
| `1.05rem` | 7 | 7 |
| `1.5rem` | 7 | 5 |
| `.65rem` | 6 | 3 |
| `.68rem` | 6 | 5 |
| `.6rem` | 6 | 5 |
| `.76rem` | 6 | 3 |
| `1.15rem` | 6 | 6 |
| `1.6rem` | 6 | 6 |
| `2rem` | 6 | 5 |
| `.83rem` | 5 | 1 |
| `1.2rem` | 5 | 4 |
| `.86rem` | 4 | 3 |
| `.875rem` | 3 | 2 |
| `.92rem` | 3 | 2 |
| `0.85rem` | 3 | 3 |
| `0.9rem` | 3 | 3 |
| `1.1rem` | 3 | 1 |
| `1.35rem` | 3 | 3 |
| `1.3rem` | 3 | 3 |
| `1.4rem` | 3 | 3 |
| `0.75rem` | 2 | 2 |
| `16px` | 2 | 2 |
| `2.5rem` | 2 | 2 |
| `.62rem` | 1 | 1 |
| `.74rem` | 1 | 1 |
| `.8125rem` | 1 | 1 |
| `.82rem !important` | 1 | 1 |
| `.85em` | 1 | 1 |
| `0.78rem` | 1 | 1 |
| `1.65rem` | 1 | 1 |
| `2.2rem` | 1 | 1 |
| `3rem` | 1 | 1 |
| `clamp(1.75rem,3.5vw,2.5rem)` | 1 | 1 |
| `clamp(1.9rem, 8vw, 2.6rem)` | 1 | 1 |
| `clamp(2.4rem,5vw,3.8rem)` | 1 | 1 |
| `inherit` | 1 | 1 |

## Font weight — 5 distinct value(s)

| Font weight | Uses | Files |
|---|---:|---:|
| `700` | 79 | 20 |
| `600` | 56 | 21 |
| `400` | 16 | 8 |
| `500` | 12 | 3 |
| `900` | 7 | 3 |

## Spacing — 60 distinct value(s)

| Spacing | Uses | Files |
|---|---:|---:|
| `.5rem` | 129 | 31 |
| `1rem` | 118 | 32 |
| `.6rem` | 87 | 28 |
| `.75rem` | 79 | 24 |
| `.4rem` | 62 | 24 |
| `1.25rem` | 53 | 17 |
| `.85rem` | 45 | 14 |
| `1.5rem` | 44 | 12 |
| `.3rem` | 36 | 15 |
| `.9rem` | 34 | 19 |
| `.25rem` | 33 | 16 |
| `.7rem` | 33 | 12 |
| `1.1rem` | 24 | 16 |
| `2rem` | 23 | 10 |
| `.35rem` | 21 | 10 |
| `0.5rem` | 21 | 10 |
| `.55rem` | 19 | 10 |
| `.15rem` | 17 | 8 |
| `.2rem` | 17 | 13 |
| `.65rem` | 16 | 3 |
| `.1rem` | 14 | 9 |
| `0.6rem` | 14 | 9 |
| `2.5rem` | 14 | 4 |
| `.8rem` | 12 | 10 |
| `.45rem` | 10 | 5 |
| `1.75rem` | 10 | 5 |
| `3rem` | 8 | 4 |
| `0.7rem` | 7 | 4 |
| `1.2rem` | 6 | 6 |
| `0.25rem` | 5 | 4 |
| `0.75rem` | 5 | 5 |
| `0.3rem` | 4 | 3 |
| `0.4rem` | 4 | 4 |
| `-.75rem` | 3 | 3 |
| `0.15rem` | 3 | 3 |
| `0.1rem` | 3 | 2 |
| `3.5rem` | 3 | 2 |
| `-.25rem` | 2 | 1 |
| `-1px` | 2 | 2 |
| `.22rem` | 2 | 1 |
| `.28rem` | 2 | 1 |
| `0.2rem` | 2 | 2 |
| `0.35rem` | 2 | 2 |
| `4rem` | 2 | 1 |
| `-1rem` | 1 | 1 |
| `-2rem` | 1 | 1 |
| `.05rem` | 1 | 1 |
| `.12rem` | 1 | 1 |
| `.18rem` | 1 | 1 |
| `.58rem` | 1 | 1 |
| `.95rem` | 1 | 1 |
| `0.05rem` | 1 | 1 |
| `0.8rem` | 1 | 1 |
| `1.15rem` | 1 | 1 |
| `1.3rem` | 1 | 1 |
| `2.4rem` | 1 | 1 |
| `2px` | 1 | 1 |
| `4.5rem` | 1 | 1 |
| `5.5rem` | 1 | 1 |
| `5rem` | 1 | 1 |

## Border radius — 15 distinct value(s)

| Border radius | Uses | Files |
|---|---:|---:|
| `var(--r4)` | 65 | 24 |
| `var(--r8)` | 39 | 21 |
| `var(--r-full)` | 25 | 7 |
| `var(--r12)` | 17 | 12 |
| `50%` | 8 | 5 |
| `$r8` | 5 | 1 |
| `$r4` | 3 | 1 |
| `0` | 3 | 3 |
| `0 var(--r4) var(--r4) 0` | 3 | 2 |
| `$r12` | 1 | 1 |
| `$radius` | 1 | 1 |
| `var(--r12) var(--r12) 0 0` | 1 | 1 |
| `var(--r20)` | 1 | 1 |
| `var(--r20) var(--r20) 0 0` | 1 | 1 |
| `var(--r4) var(--r4) 0 0` | 1 | 1 |

## Shadow — 11 distinct value(s)

| Shadow | Uses | Files |
|---|---:|---:|
| `none` | 11 | 4 |
| `var(--shadow-xl)` | 8 | 7 |
| `var(--ring-danger)` | 2 | 2 |
| `var(--shadow-lg)` | 2 | 1 |
| `var(--shadow-lift)` | 2 | 2 |
| `var(--shadow-sm)` | 2 | 1 |
| `$shadow-sm` | 1 | 1 |
| `var(--ring-gold)` | 1 | 1 |
| `var(--ring-sage)` | 1 | 1 |
| `var(--ring-terra)` | 1 | 1 |
| `var(--ring-terra),var(--shadow-md)` | 1 | 1 |
