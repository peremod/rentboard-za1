import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { Review, ReviewType, ReviewableTenancy, Tenancy, TenantReferences } from '../models/review.model';

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Ended tenancies this user can still review. Drives the dashboard prompt. */
  readonly reviewable = signal<ReviewableTenancy[]>([]);

  loadReviewable() {
    return this.http
      .get<ReviewableTenancy[]>(`${this.api}/tenancies/reviewable`)
      .pipe(tap((list) => this.reviewable.set(list)));
  }

  listMyTenancies() {
    return this.http.get<Tenancy[]>(`${this.api}/tenancies/mine`);
  }

  confirmStart(tenancyId: string, startDate?: string) {
    return this.http.post<Tenancy>(`${this.api}/tenancies/${tenancyId}/confirm-start`, { startDate });
  }

  cancelTenancy(tenancyId: string, reason?: string) {
    return this.http.post<Tenancy>(`${this.api}/tenancies/${tenancyId}/cancel`, { reason });
  }

  endTenancy(tenancyId: string, reason?: string, endDate?: string) {
    return this.http.post<Tenancy>(`${this.api}/tenancies/${tenancyId}/end`, { reason, endDate });
  }

  submit(tenancyId: string, type: ReviewType, rating: number, comment: string) {
    return this.http.post<Review>(`${this.api}/reviews`, { tenancyId, type, rating, comment });
  }

  getRoomReviews(roomId: string) {
    return this.http.get<Review[]>(`${this.api}/reviews/room/${roomId}`);
  }

  getLandlordReviews(landlordId: string) {
    return this.http.get<Review[]>(`${this.api}/reviews/landlord/${landlordId}`);
  }

  /** Only succeeds while that tenant has a live application on your room. */
  getTenantReferences(tenantId: string) {
    return this.http.get<TenantReferences>(`${this.api}/reviews/tenant/${tenantId}/references`);
  }

  respond(reviewId: string, response: string) {
    return this.http.post<Review>(`${this.api}/reviews/${reviewId}/respond`, { response });
  }
}
