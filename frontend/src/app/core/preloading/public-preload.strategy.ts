import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer, mergeMap } from 'rxjs';

/**
 * Preloads only what an anonymous visitor is plausibly about to open.
 *
 * The previous `PreloadAllModules` downloaded every lazy chunk on first paint
 * — including the landlord wizard, tenant dashboard and the whole admin area
 * — for someone who had merely landed on the homepage and might never sign
 * in. On a South African mobile connection that is hundreds of kilobytes of
 * contended bandwidth spent during the exact window that decides LCP and TBT,
 * on code the visitor cannot legally reach without a guard letting them
 * through.
 *
 * Rule: a route preloads if it is publicly reachable AND not opted out.
 * Guarded areas load on demand, at which point the person is signing in
 * anyway and a short chunk fetch is invisible next to the auth round trip.
 *
 * Opt a public route out with `data: { preload: false }`, or force an early
 * fetch on a guarded one with `data: { preload: true }`.
 */
@Injectable({ providedIn: 'root' })
export class PublicPreloadStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    const explicit = route.data?.['preload'] as boolean | undefined;
    if (explicit === false) return of(null);

    const isGuarded = (route.canActivate?.length ?? 0) > 0;
    if (isGuarded && explicit !== true) return of(null);

    // A short delay keeps preloading off the critical path: the initial route
    // finishes rendering and settles before secondary chunks compete for the
    // network. 2s is past LCP on a slow 4G connection.
    return timer(2000).pipe(mergeMap(() => load()));
  }
}
