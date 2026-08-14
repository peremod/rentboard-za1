import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n.service';
import { LanguageCode } from '../../../core/models/language.model';

/** Dropdown language switcher — lives in the navbar. */
@Component({
  selector: 'app-lang-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lang-switcher">
      <button type="button" (click)="open.update(v => !v)" [attr.aria-expanded]="open()">
        🌐 {{ i18n.currentLanguage()?.nativeName ?? 'English' }}
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
    .lang-switcher > button { background: none; border: 1px solid rgba(255,255,255,.25); color: rgba(255,255,255,.85); font-size: .75rem; padding: .3rem .6rem; border-radius: 6px; cursor: pointer; font-family: inherit; }
    .lang-switcher__menu { position: absolute; top: calc(100% + 4px); right: 0; background: #1A1410; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; list-style: none; padding: .3rem; min-width: 180px; max-height: 320px; overflow-y: auto; z-index: 60; }
    .lang-switcher__menu button { width: 100%; text-align: left; background: none; border: none; color: rgba(255,255,255,.8); font-size: .78rem; padding: .4rem .6rem; border-radius: 5px; cursor: pointer; font-family: inherit; }
    .lang-switcher__menu button:hover, .lang-switcher__menu button.active { background: rgba(255,255,255,.08); color: #fff; }
    .muted { color: rgba(255,255,255,.4); font-size: .68rem; margin-left: .3rem; }
  `],
})
export class LangSwitcher {
  i18n = inject(I18nService);
  open = signal(false);

  select(code: LanguageCode) {
    this.i18n.setLanguage(code);
    this.open.set(false);
  }
}
