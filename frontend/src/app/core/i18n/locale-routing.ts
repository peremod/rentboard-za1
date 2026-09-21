import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { CanMatchFn, NavigationEnd, Route, Router, UrlSegment } from '@angular/router';
import { IS_DISCOVERING_ROUTES } from '@angular/ssr';
import { filter } from 'rxjs';
import { I18nService } from '../services/i18n.service';
import { DEFAULT_LANGUAGE, isPrefixedLocale, stripLocalePrefix } from '../models/language.model';

/**
 * Matches ':lang' only when the first URL segment is a real prefixed locale.
 *
 * Without this, `path: ':lang'` would swallow everything — '/pricing' would
 * match with lang='pricing' and the page would 404 inside the locale subtree.
 * Returning false makes the router abandon this branch and fall through to
 * the unprefixed English routes declared after it, which is exactly the
 * behaviour we want.
 *
 * 'en' is intentionally not a prefixed locale: English lives at the bare
 * path, so '/en/pricing' correctly falls through and 404s rather than
 * becoming a duplicate of '/pricing'.
 *
 * During SSR route discovery (the build-time walk that finds which client
 * routes exist, so getPrerenderParams can be invoked for them) there are no
 * real URL segments to test — Angular calls this with a synthetic, empty
 * one. Rejecting on that would make the whole ':lang' branch look
 * unreachable, and app.routes.ts's per-locale prerender routes would never
 * get their getPrerenderParams called. IS_DISCOVERING_ROUTES is how Angular
 * says "this isn't a real navigation" so the guard can let discovery through.
 */
export const localeMatchGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]) => {
  if (inject(IS_DISCOVERING_ROUTES, { optional: true })) return true;
  return segments.length > 0 && isPrefixedLocale(segments[0].path);
};

/**
 * Applies the URL's locale on every navigation, before SEO metadata is set.
 *
 * Registered ahead of provideRouteSeo() in app.config.ts so that by the time
 * the SEO layer runs, I18nService already knows the language and the
 * canonical/hreflang set is computed against the right locale.
 */
export function provideLocaleRouting(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const router = inject(Router);
    const i18n = inject(I18nService);

    // The very first render, including SSR, happens before any NavigationEnd
    // for the initial URL on some paths — so seed from the current URL too.
    const seed = stripLocalePrefix(router.url.split('?')[0]).locale;
    void i18n.use(seed);

    router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((event) => {
      const { locale } = stripLocalePrefix(event.urlAfterRedirects.split('?')[0].split('#')[0]);
      void i18n.use(locale);
    });
  });
}

/**
 * One-time, browser-only courtesy redirect.
 *
 * A returning visitor who chose isiZulu and then types 'umastande.co.za'
 * should land on '/zu'. This runs only on the client, only on an unprefixed
 * URL, and only when a stored preference exists — so it can never affect what
 * a crawler sees, and can never fight the canonical.
 *
 * Deliberately not a server-side redirect on Accept-Language: Google crawls
 * from the United States, and redirecting it away from the English canonical
 * on a header it does not send is the classic way to have an entire site
 * deindexed.
 */
export function provideRememberedLocaleRedirect(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const router = inject(Router);
    const i18n = inject(I18nService);

    if (typeof window === 'undefined') return;

    const url = router.url.split('?')[0];
    const { locale: urlLocale, path } = stripLocalePrefix(url);
    if (urlLocale !== DEFAULT_LANGUAGE) return; // URL was explicit — respect it

    const preferred = i18n.remembered();
    if (!preferred || preferred === DEFAULT_LANGUAGE) return;

    void router.navigateByUrl(`/${preferred}${path === '/' ? '' : path}`, { replaceUrl: true });
  });
}
