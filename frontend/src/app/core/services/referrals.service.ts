import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { MyReferrals, CodeCheck } from '../models/referral.model';

@Injectable({ providedIn: 'root' })
export class ReferralsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly mine = signal<MyReferrals | null>(null);

  load() {
    return this.http
      .get<MyReferrals>(`${this.api}/referrals/mine`)
      .pipe(tap((data) => this.mine.set(data)));
  }

  /** Public check used by the signup form. */
  validate(code: string) {
    return this.http.get<CodeCheck>(`${this.api}/referrals/validate`, {
      params: new HttpParams().set('code', code),
    });
  }

  /**
   * Message templates.
   *
   * Three, because the pitch genuinely differs: a landlord tells another
   * landlord it is free to list, a landlord tells a tenant there is a room,
   * and a tenant tells a tenant applying costs nothing. One generic message
   * would be worse than none — people do not forward something that reads
   * like an advert.
   */
  shareMessage(kind: 'landlord_to_landlord' | 'landlord_to_tenant' | 'tenant_to_tenant', code: string): string {
    const link = `${window.location.origin}/auth/register?ref=${code}`;

    switch (kind) {
      case 'landlord_to_landlord':
        return `I've been letting my rooms on RentBoard — it's free to list and there's no agent taking a cut. Use my code ${code} when you sign up: ${link}`;
      case 'landlord_to_tenant':
        return `I list my rooms on RentBoard. It's free to apply and you deal with the landlord directly, no application fees. Sign up with ${code}: ${link}`;
      case 'tenant_to_tenant':
        return `Looking for a room? RentBoard is free to apply and the listings come straight from landlords, not agents. Use ${code}: ${link}`;
    }
  }

  whatsappUrl(message: string) {
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }
}
