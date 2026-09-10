import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SeoService, SeoInput } from '../services/seo.service';
import { stripLocalePrefix } from '../models/language.model';

/**
 * Applies per-route metadata declared as `data: { seo: {...} }` on each route.
 *
 * Route `title` already drives <title>. This adds everything else — the
 * description, canonical and social tags — from the same place, so a new
 * route gets its metadata by declaring it, not by remembering to inject a
 * service into the component.
 *
 * Dynamic pages (room detail) call SeoService directly once their data has
 * loaded; the route-level defaults apply first and are then overwritten, so
 * there is never a window with the wrong canonical.
 */
export type RouteSeo = Omit<SeoInput, 'path'> & {
  /** Omit to derive the canonical from the resolved URL. */
  path?: string;
};

export function provideRouteSeo(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const router = inject(Router);
    const root = inject(ActivatedRoute);
    const seo = inject(SeoService);

    router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((event) => {
      let route = root;
      while (route.firstChild) route = route.firstChild;

      const data = (route.snapshot.data['seo'] ?? {}) as RouteSeo;

      // urlAfterRedirects, not `url`: a redirected route must canonicalise to
      // where it landed, or the redirect source competes with its target.
      const path = data.path ?? event.urlAfterRedirects.split('?')[0].split('#')[0];

      // The locale comes from the URL, so a route declaring `data.seo` once
      // serves all eleven languages without eleven copies of the metadata.
      const { locale } = stripLocalePrefix(path);

      seo.apply({ ...data, path, locale });
    });
  });
}
