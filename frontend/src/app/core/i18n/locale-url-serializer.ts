import { Injectable, inject } from '@angular/core';
import { DefaultUrlSerializer, UrlSerializer, UrlTree } from '@angular/router';
import { I18nService } from '../services/i18n.service';
import { DEFAULT_LANGUAGE, localizePath, stripLocalePrefix } from '../models/language.model';

/**
 * Keeps the active locale attached to every internal navigation.
 *
 * The problem this solves: with locale-prefixed URLs, a visitor reading
 * /zu/pricing who clicks `routerLink="/how-it-works"` lands on the English
 * page. Nothing errors, nothing is logged, and the person is silently dropped
 * out of their language halfway through a flow. Multiply that by roughly
 * sixty routerLinks across the app.
 *
 * The alternatives were worse. Rewriting every template to compute a
 * localised path is sixty edit sites and a permanent new way for a future
 * link to be wrong. A directive still requires touching every template. Doing
 * it in the serializer means it is true for `routerLink`, `router.navigate`,
 * `navigateByUrl`, guard redirects and the `returnUrl` round-trip alike —
 * one place, no opt-in, nothing to remember.
 *
 * Rules:
 *   - A URL that already carries an explicit locale prefix is left exactly as
 *     written. This is what lets the language switcher navigate from
 *     /zu/pricing to /af/pricing without being pulled back to isiZulu.
 *   - English adds nothing, because English is unprefixed by design.
 *   - Only `serialize` is overridden. Parsing is untouched, so the router
 *     still matches ':lang' through the normal route config.
 */
@Injectable()
export class LocaleUrlSerializer extends DefaultUrlSerializer {
  private i18n = inject(I18nService);

  override serialize(tree: UrlTree): string {
    const url = super.serialize(tree);

    const locale = this.i18n.currentLang();
    if (locale === DEFAULT_LANGUAGE) return url;

    // Split once so query and fragment survive untouched.
    const [pathAndQuery, fragment] = url.split('#');
    const [pathname, query] = pathAndQuery.split('?');

    // Already explicit — the caller meant that locale, including 'en'
    // expressed as a bare path by the language switcher.
    if (stripLocalePrefix(pathname).locale !== DEFAULT_LANGUAGE) return url;

    const localised = localizePath(pathname, locale);
    return localised + (query ? `?${query}` : '') + (fragment ? `#${fragment}` : '');
  }
}

/** Registered in app.config.ts. Exported separately to keep that file readable. */
export const LOCALE_URL_SERIALIZER_PROVIDER = {
  provide: UrlSerializer,
  useClass: LocaleUrlSerializer,
};
