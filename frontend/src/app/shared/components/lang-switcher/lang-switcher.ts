import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../../core/services/i18n.service';
import { LanguageCode, localizePath, stripLocalePrefix } from '../../../core/models/language.model';
import { Icon } from '../icon/icon';

/** Dropdown language switcher — lives in the navbar. */
@Component({
  selector: 'app-lang-switcher',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lang-switcher">
      <button type="button" (click)="open.update(v => !v)" [attr.aria-expanded]="open()">
        <app-icon name="globe"/> {{ i18n.currentLanguage()?.nativeName ?? 'English' }}
      </button>
      @if (open()) {
        <ul class="lang-switcher__menu">
          @for (lang of i18n.languages; track lang.code) {
            <li>
              <button type="button" [class.active]="lang.code === i18n.currentLang()" (click)="select(lang.code)">
                {{ lang.nativeName }} <span class="muted">{{ lang.name }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .lang-switcher { position: relative; }
    /* 24px before Phase 7q — the smallest tap target measured anywhere in the
       app, on the control that switches the whole site's language. Not a .btn
       and not an input, so neither app-wide rule reached it. */
    /* ⚠️ The trigger lives on TWO surfaces now: the ink header and the white
       nav sheet. It was hardcoded for the dark one, so inside the sheet it
       rendered white-on-white at 1.00:1 — the same ratio and the same
       failure .hint__close shipped with, arriving by a different route:
       nothing repainted the button, the surface moved out from under it.

       Custom properties rather than a parent selector, because this is a
       component style under emulated encapsulation and a global rule in
       _responsive.scss loses to it. A custom property inherits straight
       through the shadow boundary, so the sheet sets --lang-fg and this
       button picks it up without either file naming the other's class. */
    .lang-switcher > button { background: none; border: 1px solid var(--lang-edge, rgba(255,255,255,.25)); color: var(--lang-fg, rgba(255,255,255,.85)); font-size: .75rem; padding: .3rem .6rem; border-radius: var(--r4); cursor: pointer; font-family: inherit; min-height: 44px; }
    .lang-switcher__menu { position: absolute; top: calc(100% + 4px); right: 0; background: #1A1410; border: 1px solid rgba(255,255,255,.15); border-radius: var(--r8); list-style: none; padding: .3rem; min-width: 180px; max-height: 320px; overflow-y: auto; z-index: 60; }
    /* The menu entries are tap targets too — eleven languages in a list where
       every row is something to hit with a thumb. */
    .lang-switcher__menu button { width: 100%; text-align: left; background: none; border: none; color: rgba(255,255,255,.8); font-size: .78rem; padding: .4rem .6rem; border-radius: var(--r4); cursor: pointer; font-family: inherit; min-height: 44px; }
    .lang-switcher__menu button:hover, .lang-switcher__menu button.active { background: rgba(255,255,255,.08); color: var(--white); }
    .muted { color: rgba(255,255,255,.4); font-size: .68rem; margin-left: .3rem; }
  `],
})
export class LangSwitcher {
  i18n = inject(I18nService);
  private router = inject(Router);
  open = signal(false);

  /**
   * Navigates to the same page under the chosen locale rather than swapping
   * translations in place.
   *
   * Changing language used to leave the URL untouched, which meant the
   * isiZulu version of a page had no address: it could not be linked, shared,
   * bookmarked, crawled or ranked. Navigating makes the choice part of the
   * URL, so I18nService picks it up through provideLocaleRouting and the SEO
   * layer emits the matching canonical and hreflang.
   *
   * The query string and fragment are preserved — switching language while
   * halfway through a filtered board search should not discard the filters.
   */
  select(code: LanguageCode) {
    this.open.set(false);

    // Set first, navigate second. I18nService.use() updates currentLang
    // synchronously before awaiting the bundle, and LocaleUrlSerializer reads
    // it — so the outgoing URL is built against the language just chosen
    // rather than the one being left.
    void this.i18n.use(code);

    const [pathWithHash, query] = this.router.url.split('?');
    const [pathname, hash] = pathWithHash.split('#');
    const { path } = stripLocalePrefix(pathname);

    const target =
      localizePath(path, code) + (query ? `?${query}` : '') + (hash ? `#${hash}` : '');

    void this.router.navigateByUrl(target);
  }
}
