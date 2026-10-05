import { Injectable, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';

/**
 * First-use hints, one per screen — Phase 8b.
 *
 * ── Why these exist beside the walkthrough
 *
 * The walkthrough is four or eight cards at the start, read once, before the
 * person has done anything. It can say what the product is for. It cannot teach
 * a screen, because nobody remembers a card about applicants when they reach
 * the applicants screen a week later.
 *
 * A hint is the other half: one short panel at the top of a screen, the first
 * time that account opens it, explaining what the screen is for and the one
 * thing people get wrong on it. It goes away on a tap and never returns.
 *
 * ── Why the server remembers, not the browser
 *
 * The same two reasons `walkthroughSeenAt` is on the account rather than in
 * localStorage: a phone in this market is shared, borrowed and replaced, so a
 * per-browser flag shows a hint to somebody who has read it and never reaches
 * the person who has not — and the app renders on the server, where there is no
 * localStorage to read on the first paint, so every hint would flash in a beat
 * after the content it is explaining.
 */
@Injectable({ providedIn: 'root' })
export class HintsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;
  private auth = inject(AuthService);

  /**
   * ⚠️ `?? []`, not `?? null` and not a non-null assertion.
   *
   * An older cached session answers `undefined` here. Reading that as "this
   * account has seen everything" hides every hint from the one person who has
   * seen none of them, and nothing would ever report it: the screens look
   * normal, just unexplained.
   */
  private readonly seenKeys = computed(() => new Set(this.auth.user()?.hintsSeen ?? []));

  /** Show the hint for this screen? */
  shouldShow(key: string): boolean {
    if (!this.auth.sessionResolved() || !this.auth.isAuthenticated()) return false;
    return !this.seenKeys().has(key);
  }

  /**
   * Put it away, for this account, everywhere.
   *
   * Optimistic: the user signal is patched before the request lands, so the
   * panel closes on the tap rather than after a round trip on a slow phone. If
   * the write fails the hint comes back on the next visit, which is the right
   * way round — an extra explanation is a small annoyance, and a hint that
   * vanishes for good because a request failed is a feature nobody learns.
   */
  dismiss(key: string) {
    const next = [...new Set([...(this.auth.user()?.hintsSeen ?? []), key])];
    this.auth.patchUser({ hintsSeen: next });
    this.http
      .post<{ hintsSeen: string[] }>(`${this.api}/users/me/hints/${key}`, {})
      .pipe(tap((res) => this.auth.patchUser({ hintsSeen: res.hintsSeen })))
      .subscribe({ error: () => {} });
  }
}
