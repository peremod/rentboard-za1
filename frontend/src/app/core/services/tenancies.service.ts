import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { Tenancy, ReviewableTenancy, TenancyFlag, TenancyFlagReason } from '../models/tenancy.model';

@Injectable({ providedIn: 'root' })
export class TenanciesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly tenancies = signal<Tenancy[]>([]);
  readonly reviewable = signal<ReviewableTenancy[]>([]);

  load() {
    return this.http
      .get<Tenancy[]>(`${this.api}/tenancies/mine`)
      .pipe(tap((list) => this.tenancies.set(list)));
  }

  loadReviewable() {
    return this.http
      .get<ReviewableTenancy[]>(`${this.api}/tenancies/reviewable`)
      .pipe(tap((list) => this.reviewable.set(list)));
  }

  /** Either party may confirm — see TenanciesService on the API for why. */
  confirmStart(id: string, startDate?: string) {
    return this.http
      .post<Tenancy>(`${this.api}/tenancies/${id}/confirm-start`, { startDate })
      .pipe(tap((t) => this.replace(t)));
  }

  cancel(id: string, reason?: string) {
    return this.http
      .post<Tenancy>(`${this.api}/tenancies/${id}/cancel`, { reason })
      .pipe(tap((t) => this.replace(t)));
  }

  /** Ending is what opens the review window. */
  end(id: string, reason?: string, endDate?: string) {
    return this.http
      .post<Tenancy>(`${this.api}/tenancies/${id}/end`, { reason, endDate })
      .pipe(tap((t) => this.replace(t)));
  }

  // ── Post-tenancy dispute reports ─────────────────────────────────────────
  //
  // The API has had all of this since v1.56.0 and nothing in the app called
  // it: neither party could raise a report, see their own, or withdraw one,
  // and no admin could read the queue. A feature reachable only by curl is not
  // a feature, and the checklist recorded it as built.

  readonly myFlags = signal<TenancyFlag[]>([]);

  loadMyFlags() {
    return this.http
      .get<TenancyFlag[]>(`${this.api}/tenancies/flags/mine`)
      .pipe(tap((list) => this.myFlags.set(list)));
  }

  /** `against` is derived from the tenancy by the API — never sent from here. */
  raiseFlag(tenancyId: string, reason: TenancyFlagReason, detail: string) {
    return this.http
      .post<TenancyFlag>(`${this.api}/tenancies/${tenancyId}/flag`, { reason, detail })
      .pipe(tap((flag) => this.myFlags.update((list) => [flag, ...list])));
  }

  /** While it is still open. People cool off, and that has to be possible. */
  withdrawFlag(id: string) {
    return this.http
      .patch<TenancyFlag>(`${this.api}/tenancies/flags/${id}/withdraw`, {})
      .pipe(tap((flag) => this.myFlags.update((list) => list.map((f) => (f.id === flag.id ? flag : f)))));
  }

  private replace(updated: Tenancy) {
    this.tenancies.update((list) => list.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
  }
}
