import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { Tenancy, ReviewableTenancy } from '../models/tenancy.model';

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

  private replace(updated: Tenancy) {
    this.tenancies.update((list) => list.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
  }
}
