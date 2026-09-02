import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

/**
 * Aggregate UX reporting.
 *
 * Sends an event name and, at most, a coarse segment like 'mobile'. No user id,
 * no session id, nothing that could identify anyone — which is what lets the
 * Advertise page keep saying we run no profiling.
 *
 * Every call is fire-and-forget. A failed counter must never affect the page
 * that reported it.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Coarse enough to be useful, too coarse to identify anyone. */
  private segment(): string {
    if (typeof window === 'undefined') return 'server';
    return window.innerWidth < 768 ? 'mobile' : 'desktop';
  }

  track(event: string) {
    // Server-side rendering would report events nobody performed.
    if (typeof window === 'undefined') return;

    this.http
      .post(`${this.api}/analytics/event`, { event, segment: this.segment() })
      .subscribe({ error: () => {} });
  }
}
