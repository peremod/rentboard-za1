import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The three sizes the logo ships. Nothing else is allowed — see the floor below. */
export type LogoSize = 'sm' | 'md' | 'lg';

/**
 * The wordmark — Phase I. One component, two spans, one fixed colour for MA.
 *
 * ── Why this exists
 *
 * The markup was written twice (`navbar.ts`, `footer.ts`) and the rules twice
 * (`.nav-logo` / `.nav-logo span`, `.footer-logo` / `.footer-logo span`). This
 * repo's own `landlordNav` comment records where that ends: the portal nav was
 * defined six times, the copies disagreed, and the sidebar shrank as a person
 * moved through their own portal. A second copy is always the one that does not
 * get the fix.
 *
 * ── MA holds its colour, and cannot be overridden from outside
 *
 * The requirement is that the **MA** portion is the same colour and styling
 * wherever the logo appears. So MA is its own element with its own token,
 * `--logo-ma`, set in the component's own scoped rule. Angular's emulated
 * encapsulation rewrites that rule with an attribute selector, so it is more
 * specific than anything a parent stylesheet can say about `app-logo *`, and
 * `color` is declared on `.logo__ma` itself rather than inherited — a parent
 * setting `color` on the anchor moves the stem and cannot touch MA.
 *
 * ⚠️ The old split was `Mas` / `tande`, not `MA` / `stande`. "MA" was part of
 * an unnamed text node with no element of its own, so it inherited whatever
 * `color` the surrounding class happened to set. There was nothing to pin.
 *
 * ── Why there is no `surface` input
 *
 * The audit's plan called for one (`surface: 'dark' | 'light'`). That is a
 * worse design: an input with two values has a wrong value, and the wrong
 * value here renders cream on cream or ink on ink — an invisible wordmark, the
 * exact failure mode G3 was about. Both current homes are dark (`--ink` header,
 * `--ink` footer) and nothing stops a third placement being light.
 *
 * So the stem is `currentColor`. It inherits the surrounding text colour,
 * which is by definition already right for the surface it is on and is already
 * measured there by `scripts/a11y-drive.mjs`. There is no input to get wrong.
 *
 * ── Why #C4522C and not --terra or --terra2
 *
 * One fixed colour has to be legible on `--ink` (the header and footer) AND on
 * `--cream` / `--card` / `--white` (every other surface in the system). The
 * existing tokens each fail one side: `--terra` (#AD4222) is 3.06:1 on ink,
 * `--terra2` (#E06038) is 3.33:1 on cream, and `--terra-deep` is 2.28:1 on ink.
 *
 * Searched, not guessed: the best achievable minimum across those five
 * surfaces is **3.92:1**, because anything light enough for #1C160E is too
 * light for #FFFFFF. #C4522C reaches that ceiling and is the closest to the
 * brand of the values that do — ΔE 7.6 from `--terra` and 8.7 from `--terra2`,
 * sitting between the two terracottas it replaces here.
 *
 * ⚠️ **3.92 is below the 4.5:1 small-text threshold and that is deliberate.**
 * WCAG's large-text threshold is 3:1, and it applies at 18.66px bold or more.
 * The wordmark is 900 weight at 1.25rem / 1.5rem / 1.6rem — 20 / 24 / 25.6px —
 * so every size this component ships qualifies, with 1.34px of margin at the
 * smallest. That justification is load-bearing, so it is asserted rather than
 * trusted: `scripts/logo-drive.mjs` measures the rendered font size and weight
 * at every placement and every width and fails below the floor. A fourth,
 * smaller size added here without changing the colour would be a contrast
 * failure that looks like a styling tweak.
 */
const FLOOR_PX = 18.66;

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (link()) {
      <a class="logo logo--{{ size() }}" routerLink="/" [attr.aria-label]="label()">
        <span class="logo__ma">Ma</span><span class="logo__stem">stande</span>
      </a>
    } @else {
      <span class="logo logo--{{ size() }}" role="img" [attr.aria-label]="label()">
        <span class="logo__ma">Ma</span><span class="logo__stem">stande</span>
      </span>
    }
  `,
  styles: [`
    /* The host contributes no box of its own, so dropping <app-logo> into a
       flex row behaves exactly as the bare <a> it replaces did. */
    :host { display: contents; }

    .logo {
      /* ⚠️ 'inherit', and it is not redundant.
         The stem reads currentColor, and the logo's root is an <a>. The global
         'a { color: $color-terracotta }' in styles.scss has specificity (0,0,1)
         and applies to this very element, so without this line currentColor
         resolves to --terra rather than to the surface's foreground. Measured
         by scripts/logo-drive.mjs on the first run: the stem came back
         rgb(173, 66, 34) at 3.06:1 on --ink — passing the 3:1 large-text floor
         by 0.06 and not remotely what was designed. With 'inherit' it is
         --cream at 16.77:1.
         This DEFERS the colour; it does not pin it. Do not replace it with a
         real colour: that would set both halves and the whole point of
         .logo__ma having its own token would be gone. */
      color: inherit;
      font-family: var(--font-display);
      font-weight: 900;
      letter-spacing: -.5px;
      flex-shrink: 0;
      cursor: pointer;
      text-decoration: none;
    }
    .logo:hover { text-decoration: none; }

    /* ⚠️ MA. Its own element, its own token, declared here and not inherited.
       A parent that sets 'color' on app-logo moves the stem and cannot move
       this. Do not add a 'color' to .logo itself — that is what the stem's
       currentColor reads, and setting it here would pin both halves. */
    .logo__ma { color: var(--logo-ma); }

    /* The stem follows the surrounding text, so the logo is legible on any
       surface without being told which surface it is on. See the 'inherit'
       note above for why the root has to defer explicitly. */
    .logo__stem { color: currentColor; }

    /* 25.6 / 24 / 20px at weight 900 — all three above the 18.66px bold floor
       that makes 3:1 the applicable contrast threshold. See the header. */
    .logo--lg { font-size: 1.6rem; }
    .logo--md { font-size: 1.5rem; }
    .logo--sm { font-size: 1.25rem; }

    /* The header's logo shrinks on a phone so the nav row still fits Log in
       and Get started beside it — both of which must stay in the header and
       not move into the drawer. This was '.nav-logo { font-size: 1.25rem }' in
       _responsive.scss, where the component could not see it; the logo's own
       responsive behaviour belongs with the logo. Breakpoints here are
       900/768/480 and this one was, and stays, 480. 1.25rem is 20px, still
       above the 18.66px bold floor. */
    @media (max-width: 480px) {
      .logo--lg { font-size: 1.25rem; }
    }
  `],
})
export class Logo {
  /** 'lg' header, 'md' footer, 'sm' the phone header and the portal sidebar. */
  size = input<LogoSize>('md');

  /**
   * Render as a link home. `false` for a placement already inside an anchor,
   * where a nested link is invalid HTML and unreachable by keyboard.
   */
  link = input(true, { transform: (v: boolean | string) => v !== false && v !== 'false' });

  /**
   * ⚠️ The accessible name must CONTAIN the visible text, or WCAG 2.5.3 (Label
   * in Name) fails and `a11y-drive` reports a name/text mismatch. Visible text
   * is "MAstande"; this is "Mastande, home". Splitting the word into two spans
   * is also why the name is given explicitly: a screen reader handed "MA" as
   * its own element may spell it out.
   */
  protected label = computed(() => (this.link() ? 'Mastande, home' : 'Mastande'));

  /** Exported so the drive can assert against the same number, not a copy. */
  static readonly FLOOR_PX = FLOOR_PX;
}
