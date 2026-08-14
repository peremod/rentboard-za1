import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

/**
 * All checkout flows redirect the full page to Stripe Checkout — no card
 * fields are ever rendered by RentBoard itself, so there is no PCI scope
 * on our side beyond redirecting.
 */
@Injectable({ providedIn: 'root' })
export class StripeService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  upgradePlan(planTier: 'pro' | 'agency', interval: 'monthly' | 'annual') {
    this.redirectToCheckout(`${this.api}/stripe/checkout/plan`, { planTier, interval });
  }

  purchasePassport(interval: 'monthly' | 'annual') {
    this.redirectToCheckout(`${this.api}/stripe/checkout/passport`, { interval });
  }

  boostRoom(roomId: string) {
    this.redirectToCheckout(`${this.api}/stripe/checkout/boost`, { roomId });
  }

  private redirectToCheckout(url: string, body: object) {
    this.http.post<{ url: string }>(url, body).subscribe({
      next: (res) => { if (res.url) window.location.href = res.url; },
    });
  }
}
