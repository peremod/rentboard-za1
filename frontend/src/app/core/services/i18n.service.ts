import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, catchError, of } from 'rxjs';
import { SUPPORTED_LANGUAGES, LanguageCode, DEFAULT_LANGUAGE } from '../models/language.model';

const LANG_STORAGE_KEY = 'rb_lang';

/**
 * I18nService — signal-based translation engine, no external library.
 * Angular's built-in $localize is compile-time (separate build per
 * language) — too heavy for an MVP that needs 11 languages behind one
 * runtime toggle. This is deliberately lightweight instead.
 *
 * Language detection order: localStorage ('rb_lang') → browser
 * (navigator.language) → 'en' default.
 *
 * NOTE: the reference design also prioritises a logged-in user's saved
 * profile preference above localStorage. That requires a `preferredLanguage`
 * field on User plus a Users module/endpoint to persist it — neither exists
 * yet (see README §19). localStorage-only means the choice doesn't yet
 * follow a user across devices; that's the one open gap versus the full
 * design, not a silent omission.
 *
 * Usage:
 *   const i18n = inject(I18nService);
 *   i18n.translate('nav.browse_rooms')          // → 'Browse Rooms'
 *   i18n.translate('found_rooms', { count: 5 }) // → 'Found 5 rooms'
 *   // or in templates: {{ 'nav.browse_rooms' | translate }}
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private http = inject(HttpClient);

  private readonly _currentLang = signal<LanguageCode>(this.detectInitialLanguage());
  private readonly _translations = signal<Record<string, string>>({});
  private readonly _fallback = signal<Record<string, string>>({});
  private readonly _loading = signal(true);

  readonly currentLang = this._currentLang.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly languages = SUPPORTED_LANGUAGES;
  readonly currentLanguage = computed(() => this.languages.find((l) => l.code === this._currentLang()));

  constructor() {
    this.loadLanguage(this._currentLang());
  }

  async setLanguage(code: LanguageCode) {
    if (code === this._currentLang()) return;
    localStorage.setItem(LANG_STORAGE_KEY, code);
    this._currentLang.set(code);
    await this.loadLanguage(code);
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

  private async loadLanguage(code: LanguageCode) {
    this._loading.set(true);

    // English always loads as the fallback set, even when viewing another language,
    // so a missing key in e.g. zu.json degrades to an English word, never a raw key.
    if (Object.keys(this._fallback()).length === 0) {
      const en = await this.fetchTranslations('en');
      this._fallback.set(en);
    }

    const translations = code === 'en' ? this._fallback() : await this.fetchTranslations(code);
    this._translations.set(translations);
    this._loading.set(false);
  }

  private fetchTranslations(code: LanguageCode): Promise<Record<string, string>> {
    return firstValueFrom(
      this.http.get<Record<string, string>>(`/assets/i18n/${code}.json`).pipe(
        catchError(() => of({} as Record<string, string>)),
      ),
    );
  }

  private detectInitialLanguage(): LanguageCode {
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY) as LanguageCode | null;
      if (stored && this.isSupported(stored)) return stored;
    } catch { /* localStorage unavailable (SSR) — fall through */ }

    if (typeof navigator !== 'undefined') {
      const browserLang = navigator.language?.slice(0, 2) as LanguageCode;
      if (this.isSupported(browserLang)) return browserLang;
    }
    return DEFAULT_LANGUAGE;
  }

  private isSupported(code: string): code is LanguageCode {
    return SUPPORTED_LANGUAGES.some((l) => l.code === code);
  }
}
