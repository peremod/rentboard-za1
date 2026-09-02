import { Injectable, inject } from '@angular/core';
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

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => {
        this.history.push(event.urlAfterRedirects);
        // Only the last few matter; anything older is not a back destination.
        if (this.history.length > 5) this.history.shift();
      });
  }

  /** The most recent route that is not the one being displayed now. */
  previousUrl(): string | null {
    const current = this.router.url;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i] !== current) return this.history[i];
    }
    return null;
  }

  /**
   * Where a back link should point, and what to call it.
   *
   * Falls back to the board, which is the right destination for someone who
   * arrived on a room from a search engine or a shared link.
   */
  backTarget(): { url: string; label: string } {
    const previous = this.previousUrl() ?? '';

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
  }
}
