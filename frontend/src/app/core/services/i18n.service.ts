import { Injectable, inject, signal, computed } from '@angular/core';
import {
  SUPPORTED_LANGUAGES,
  SELECTABLE_LANGUAGES,
  LanguageCode,
  DEFAULT_LANGUAGE,
  isLanguageCode,
} from '../models/language.model';
import { TRANSLATION_BUNDLES } from '../i18n/translation-bundles';
import { SeoService } from './seo.service';

const LANG_STORAGE_KEY = 'rb_lang';

/**
 * I18nService — signal-based translation engine, no external library.
 *
 * Angular's built-in $localize is compile-time: it needs one full build per
 * language, which for 11 languages means 11 deploy artefacts. This is a
 * runtime engine instead, but as of the locale-routing change it is no longer
 * *only* runtime — the language is now part of the URL, so each locale has
 * its own crawlable, linkable, server-rendered address.
 *
 * Source of truth, in order:
 *   1. The URL's locale prefix (/af/…, /zu/…) — set by localeInitializer
 *   2. localStorage ('rb_lang') — used only to redirect a returning visitor
 *      who lands on a bare English URL
 *   3. navigator.language
 *   4. 'en'
 *
 * The URL wins outright. A visitor who saved 'zu' and then follows an
 * English link must get the English page, because that is the page the link
 * and the canonical both promise.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private seo = inject(SeoService);

  private readonly _currentLang = signal<LanguageCode>(DEFAULT_LANGUAGE);
  private readonly _translations = signal<Record<string, string>>({});
  private readonly _fallback = signal<Record<string, string>>({});
  private readonly _loading = signal(true);

  readonly currentLang = this._currentLang.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Offered in the switcher — translated locales only. */
  readonly languages = SELECTABLE_LANGUAGES;
  /** All eleven, including stubs. Used for lookups, never for offering a choice. */
  readonly allLanguages = SUPPORTED_LANGUAGES;
  readonly currentLanguage = computed(() => this.allLanguages.find((l) => l.code === this._currentLang()));

  /**
   * Applies a locale. Called by localeInitializer on every navigation, and
   * awaited during SSR so the server renders translated HTML rather than
   * English that flips after hydration.
   */
  async use(code: LanguageCode): Promise<void> {
    if (code === this._currentLang() && !this._loading()) return;

    this._loading.set(true);
    this._currentLang.set(code);

    // English always loads as the fallback set, even when viewing another
    // language, so a missing key in e.g. zu.json degrades to an English word,
    // never a raw dot-notation key shown to a real person.
    if (Object.keys(this._fallback()).length === 0) {
      this._fallback.set(await this.load('en'));
    }

    this._translations.set(code === 'en' ? this._fallback() : await this.load(code));
    this._loading.set(false);

    // Keeps <html lang> honest. A page of isiZulu declaring lang="en" is
    // mispronounced by screen readers and flagged by Lighthouse.
    this.seo.setHtmlLang(this.currentLanguage()?.hreflang ?? 'en-ZA');
    this.remember(code);
  }

  /** Dot-notation key lookup with {{param}} interpolation and English fallback. */
  translate(key: string, params?: Record<string, string | number>): string {
    let value = this._translations()[key] ?? this._fallback()[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
      }
    }
    return value;
  }

  /**
   * The visitor's remembered preference, if any. Used only to offer a
   * redirect from a bare English URL — never to override an explicit one.
   */
  remembered(): LanguageCode | null {
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      return stored && isLanguageCode(stored) ? stored : null;
    } catch {
      return null; // localStorage unavailable (SSR, or blocked cookies)
    }
  }

  /** Best guess from the browser, for a first-time visitor. */
  detectFromBrowser(): LanguageCode {
    if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
    const tag = navigator.language?.toLowerCase() ?? '';
    // 'nso' is three letters; check the full subtag before the two-letter one.
    const full = tag.split('-')[0];
    return isLanguageCode(full) ? full : DEFAULT_LANGUAGE;
  }

  private remember(code: LanguageCode) {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, code);
    } catch {
      /* nothing to do — the URL still carries the locale */
    }
  }

  private async load(code: LanguageCode): Promise<Record<string, string>> {
    try {
      return await TRANSLATION_BUNDLES[code]();
    } catch {
      // A missing or malformed bundle must degrade to English, not a blank page.
      return {};
    }
  }
}
