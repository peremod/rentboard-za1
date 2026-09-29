import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { LandlordHealth, LandlordInbox } from '../models/landlord-inbox.model';

/** Two reads: what needs doing, and how the business is doing. Neither writes. */
@Injectable({ providedIn: 'root' })
export class LandlordInboxService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  inbox() {
    return this.http.get<LandlordInbox>(`${this.api}/landlord/inbox`);
  }

  health() {
    return this.http.get<LandlordHealth>(`${this.api}/landlord/health`);
  }
}
