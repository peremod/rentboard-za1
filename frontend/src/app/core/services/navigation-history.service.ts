import { Injectable, computed, inject, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Remembers the previous in-app route.
 *
 * Exists so a page can offer a back link that returns where the person
 * actually came from. A room opened from a landlord's dashboard should go back
 * to that dashboard, not to the public board — the board is not where they
 * were, and sending them there loses their place.
 *
 * Deliberately not browser history: location.back() can leave the site
 * entirely if the room was the first page loaded, and cannot be labelled
 * meaningfully because we would not know where it goes.
 */
@Injectable({ providedIn: 'root' })
export class NavigationHistoryService {
  private router = inject(Router);

  /**
   * Recent routes, newest last. A short stack rather than a single 'previous'
   * because NavigationEnd fires AFTER the incoming component is constructed —
   * a component reading 'previous' during init would get the page before the
   * one it came from, which is one step too far back.
   *
   * Resolving against the router's current URL instead avoids depending on
   * that ordering at all.
   */
  private readonly history: string[] = [];

  /**
   * The route navigated away FROM, tracked explicitly.
   *
   * This replaces comparing the stack against `router.url`, which did not work
   * and shipped broken. NavigationEnd fires after the incoming component's
   * ngOnInit, so at the moment a component asked, `router.url` was still the
   * PREVIOUS url — and "the most recent entry that is not the current url"
   * therefore skipped the page the person had just come from and returned the
   * one before it.
   *
   * The visible result: opening a room from the landlord dashboard offered
   * "Back to all rooms" instead of "Back to your dashboard", sending a landlord
   * to the public board and losing their place. Reported from a phone;
   * reproduced in a browser before this was changed.
   *
   * A signal rather than a method, so a component that reads it during init
   * gets the right answer once navigation settles instead of a stale one
   * forever.
   */
  private readonly previous = signal<string | null>(null);
  private currentUrl: string | null = null;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => {
        // The page being left becomes the back destination, before the new one
        // becomes current. No comparison against router.url anywhere.
        if (this.currentUrl && this.currentUrl !== event.urlAfterRedirects) {
          this.previous.set(this.currentUrl);
        }
        this.currentUrl = event.urlAfterRedirects;

        this.history.push(event.urlAfterRedirects);
        // Only the last few matter; anything older is not a back destination.
        if (this.history.length > 5) this.history.shift();
      });
  }

  /** The route navigated away from, or null on a first page load. */
  previousUrl(): string | null {
    return this.previous();
  }

  /**
   * Where a back link should point, and what to call it.
   *
   * Falls back to the board, which is the right destination for someone who
   * arrived on a room from a search engine or a shared link.
   */
  readonly backTarget = computed<{ url: string; label: string }>(() => {
    const previous = this.previous() ?? '';

    if (previous.startsWith('/landlord/rooms') && previous.includes('/applicants')) {
      return { url: previous, label: '← Back to applicants' };
    }
    if (previous.startsWith('/landlord')) {
      return { url: '/landlord/dashboard', label: '← Back to your dashboard' };
    }
    if (previous.startsWith('/tenant')) {
      return { url: '/tenant/dashboard', label: '← Back to your dashboard' };
    }
    if (previous.startsWith('/admin')) {
      return { url: previous, label: '← Back to admin' };
    }
    return { url: '/', label: '← Back to all rooms' };
  });
}
