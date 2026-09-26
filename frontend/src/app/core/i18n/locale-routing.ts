import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { PlatformLocation } from '@angular/common';
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
    const platformLocation = inject(PlatformLocation);

    // PlatformLocation, not Router.url. Inside an app initializer the router
    // has not navigated yet, so `router.url` is '/' whatever was requested —
    // which seeded every locale as English and left the real locale to the
    // NavigationEnd subscription below, unawaited. /af came out translated and
    // /af/pricing did not, depending on which resolved first.
    //
    // PlatformLocation is the request URL on the server and the address bar in
    // the browser, and it is correct before anything has navigated.
    const seed = stripLocalePrefix(platformLocation.pathname.split('?')[0]).locale;

    // Subscribed before the await below, so a navigation that lands while the
    // first bundle is still loading is not missed.
    router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((event) => {
      const { locale } = stripLocalePrefix(event.urlAfterRedirects.split('?')[0].split('#')[0]);
      void i18n.use(locale);
    });

    // RETURNED, not `void`ed. This is the whole point of doing it in an app
    // initializer: Angular waits for the promise before the first render, and
    // a fire-and-forget call means it does not.
    //
    // It was `void i18n.use(seed)`, and the consequence was not subtle —
    // /af and /af/pricing served the entire page in English with
    // lang="af-ZA" on it, while /zu sometimes came out translated and
    // sometimes did not, depending on whether the bundle's dynamic import
    // happened to resolve before the render finished. Every check pointed the
    // other way: the lang attribute was right, the canonical was right, the
    // hreflang set was right, the bundle was complete and correctly loaded in
    // the browser after hydration. Only the served HTML was wrong, which is
    // the one thing a crawler reads.
    //
    // English returns synchronously (the bundle is a static import), so a bare
    // URL waits for nothing and this costs the default locale no time at all.
    return i18n.use(seed);
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
